const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

const builder = new addonBuilder({
    id: 'org.onepace.torbox',
    version: '3.5.1',
    name: 'One Pace Torbox Addon',
    description: 'Direct streaming of fan-edited One Pace episodes powered by Torbox.',
    resources: ['stream'],
    types: ['series'],
    catalogs: []
});

/**
 * Robust cache matching handler capable of navigating all variation patterns
 * returned across diverse versions of the Torbox cache inspection engine.
 */
function determineCacheStatus(cacheData, infoHash) {
    if (!cacheData) return false;
    const targetHash = infoHash.toLowerCase();

    // Pattern 1: Array payload
    if (Array.isArray(cacheData)) {
        return cacheData.some(item => {
            if (typeof item === 'string') return item.toLowerCase() === targetHash;
            const h = item.hash || item.info_hash || '';
            return h.toLowerCase() === targetHash;
        });
    }
    
    // Pattern 2: Key-mapped object mapping
    if (typeof cacheData === 'object') {
        const matchingKey = Object.keys(cacheData).find(k => k.toLowerCase() === targetHash);
        if (matchingKey) {
            const val = cacheData[matchingKey];
            return val === true || val?.cached === true || (Array.isArray(val?.files) && val.files.length > 0);
        }
    }

    return cacheData === true;
}

builder.defineStreamHandler(async ({ type, id }) => {
    if (type !== 'series' || !id.startsWith('onepace_')) {
        return { streams: [] };
    }

    console.log(`[Stream Handler] Request received for Stremio ID: ${id}`);

    // Safely parse out format: onepace_[arc_slug]_[episode_number]
    const parts = id.split('_');
    if (parts.length < 3) {
        console.error(`[Stream Handler] Invalid ID structure received: ${id}`);
        return { streams: [] };
    }

    const episode = parseInt(parts.pop(), 10);
    const arcSlug = parts.slice(1).join('_'); 
    
    // Convert arc slug back to presentation format for Nyaa search (e.g., "romance_dawn" -> "Romance Dawn")
    const arcName = arcSlug
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    const epPad = String(episode).padStart(2, '0');
    console.log(`[Stream Handler] Parsed Target -> Arc: "${arcName}", Episode: ${episode} (${epPad})`);

    const token = process.env.TORBOX_API_KEY;
    if (!token) {
        console.error("[Stream Handler] CRITICAL: TORBOX_API_KEY environment variable is not set.");
        return { streams: [] };
    }

    const headers = { 'Authorization': `Bearer ${token}` };

    try {
        // 1. Locate the best release from Nyaa using your prioritizer scraper logic
        const bestRelease = await fetchChronologicalRelease(arcName, epPad, episode);
        if (!bestRelease || !bestRelease.magnet) {
            console.error(`[Stream Handler] Failed to find a valid release on Nyaa for ${arcName} Ep ${episode}`);
            return { streams: [] };
        }

        const torrentTitle = bestRelease.title;
        const magnet = bestRelease.magnet;
        
        const hashMatch = magnet.match(/xt=urn:btih:([a-fA-F0-9]{40}|[2-7a-zA-Z]{32})/);
        if (!hashMatch) {
            console.error("[Stream Handler] Could not parse infoHash from magnet link string.");
            return { streams: [] };
        }
        const infoHash = hashMatch[1].toLowerCase();
        console.log(`[Stream Handler] Selected Torrent Hash: ${infoHash}`);

        // 2. Check Torbox Instant Cached Availability
        console.log("[Torbox API] Verifying cache status via /checkcached...");
        const cacheRes = await axios.get(`https://api.torbox.app/v1/api/torrents/checkcached`, {
            params: { hash: infoHash, format: 'list' },
            headers: headers
        });

        const isCached = determineCacheStatus(cacheRes.data?.data, infoHash);
        console.log(`[Torbox API] Is item completely cached? -> ${isCached}`);

        if (isCached) {
            // 3. Add to user cloud dashboard to acquire an active torrent_id
            console.log("[Torbox API] Sending /createtorrent command using standard multipart layout...");
            const createRes = await axios.post(
                'https://api.torbox.app/v1/api/torrents/createtorrent', 
                { magnet: magnet }, 
                { headers: { ...headers, 'Content-Type': 'multipart/form-data' } }
            );

            const torrentId = createRes.data?.data?.torrent_id || createRes.data?.data?.id;
            if (!torrentId) {
                console.error("[Torbox API] Failed to acquire a valid torrent_id from creation response:", createRes.data);
                return { streams: [] };
            }
            console.log(`[Torbox API] Torrent successfully associated. Torrent ID: ${torrentId}`);

            // 4. Retrieve specific list of files to select target video file_id
            console.log(`[Torbox API] Pulling file tree mapping via /mylist for ID: ${torrentId}...`);
            const infoRes = await axios.get(`https://api.torbox.app/v1/api/torrents/mylist`, {
                params: { id: torrentId },
                headers: headers
            });

            // Handle object-direct wrapper or array wrapped returns cleanly
            const torrentData = infoRes.data?.data;
            const files = Array.isArray(torrentData) ? torrentData[0]?.files : torrentData?.files;

            let fileId = null;
            if (Array.isArray(files)) {
                const videoFiles = files.filter(f => {
                    const name = f.name.toLowerCase();
                    return name.endsWith('.mp4') || name.endsWith('.mkv') || name.endsWith('.avi') || name.endsWith('.webm');
                });

                console.log(`[Torbox API] Found ${videoFiles.length} playable video tracks inside torrent folder.`);

                if (videoFiles.length === 1) {
                    fileId = videoFiles[0].id;
                } else if (videoFiles.length > 1) {
                    // Tier 1: Fixed strict regex numeric isolation
                    const strictRegex = new RegExp(`(?<!\\d)0*${episode}(?!\\d)`);
                    let matchedFile = videoFiles.find(f => strictRegex.test(f.name));

                    // Tier 2: Flexible pattern fallbacks (e.g. E01, Ep.1, etc.)
                    if (!matchedFile) {
                        const flexibleRegexes = [
                            new RegExp(`e0*${episode}(?!\\d)`, 'i'),
                            new RegExp(`ep\\s*0*${episode}(?!\\d)`, 'i'),
                            new RegExp(`\\b0*${episode}\\b`)
                        ];
                        for (const regex of flexibleRegexes) {
                            matchedFile = videoFiles.find(f => regex.test(f.name));
                            if (matchedFile) break;
                        }
                    }

                    // Tier 3: Substring check fallback
                    if (!matchedFile) {
                        matchedFile = videoFiles.find(f => f.name.includes(epPad));
                    }

                    // Tier 4: Fail-safe structural default to prevent complete stream collapse
                    if (!matchedFile) {
                        console.log("[Stream Handler] File matching missed. Defaulting to first sequential payload file track.");
                        matchedFile = videoFiles[0];
                    }

                    fileId = matchedFile?.id || null;
                }
            }

            console.log(`[Torbox API] Selected Targeted File ID: ${fileId}`);

            // 5. Generate secure streaming link via /requestdl 
            // CRITICAL: Passed 'token' directly as an integrated query parameter object requirement
            console.log("[Torbox API] Requesting final streaming link from secure CDN engine...");
            const dlParams = { 
                token: token, 
                torrent_id: torrentId 
            };
            if (fileId) dlParams.file_id = fileId;

            const dlRes = await axios.get(`https://api.torbox.app/v1/api/torrents/requestdl`, {
                params: dlParams,
                headers: headers
            });

            const streamUrl = dlRes.data?.data;
            if (dlRes.data?.success && streamUrl) {
                console.log(`[Stream Handler] SUCCESS! Secured playable url link: ${streamUrl}`);
                return {
                    streams: [{
                        name: 'Torbox\n[READY]',
                        title: `${torrentTitle}\n⚡ Stream Target Initialized`,
                        url: streamUrl
                    }]
                };
            } else {
                console.error("[Torbox API] /requestdl failed or returned empty payload:", dlRes.data);
                return { streams: [] };
            }
        } else {
            console.log(`[Stream Handler] Torrent is uncached on Torbox. Returning queue placeholders.`);
            return {
                streams: [{
                    name: 'Torbox\n[DOWNLOADING]',
                    title: `Caching... Check back later.\nTorbox caching engine processing: ${arcName} ${epPad}`,
                    url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
                }]
            };
        }
    } catch (error) {
        console.error("### [CRITICAL] Torbox Pipeline Failure ###");
        if (error.response) {
            console.error(`Status Code: ${error.response.status}`);
            console.error("Response Details:", JSON.stringify(error.response.data));
        } else {
            console.error(`Error Message: ${error.message}`);
        }
        return { streams: [] };
    }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log('Standalone One Pace Catalog Addon v3.5.1 active on port 7000');
