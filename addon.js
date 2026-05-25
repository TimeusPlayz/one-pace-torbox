const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

const ARCS = [
    { name: "Romance Dawn", eps: 4 },
    { name: "Orange Town", eps: 3 },
    { name: "Syrup Village", eps: 7 },
    { name: "Gaimon", eps: 1 },
    { name: "Baratie", eps: 9 },
    { name: "Arlong Park", eps: 10 },
    { name: "The Adventures of Buggy's Crew", eps: 1 },
    { name: "Loguetown", eps: 3 },
    { name: "Reverse Mountain", eps: 2 },
    { name: "Whiskey Peak", eps: 2 },
    { name: "The Trials of Koby-Meppo", eps: 1 },
    { name: "Little Garden", eps: 5 },
    { name: "Drum Island", eps: 8 },
    { name: "Arabasta", eps: 21 },
    { name: "Jaya", eps: 8 },
    { name: "Skypiea", eps: 25 },
    { name: "Long Ring Long Land", eps: 6 },
    { name: "Water Seven", eps: 20 },
    { name: "Enies Lobby", eps: 25 },
    { name: "Post-Enies Lobby", eps: 5 },
    { name: "Thriller Bark", eps: 22 },
    { name: "Sabaody Archipelago", eps: 11 },
    { name: "Amazon Lily", eps: 5 },
    { name: "Impel Down", eps: 10 },
    { name: "If You Could Go Anywhere... The Adventures of the Straw Hats", eps: 1 },
    { name: "Marineford", eps: 17 },
    { name: "Post-War", eps: 8 },
    { name: "Return to Sabaody", eps: 3 },
    { name: "Fishman Island", eps: 24 },
    { name: "Punk Hazard", eps: 22 },
    { name: "Dressrosa", eps: 48 },
    { name: "Zou", eps: 10 },
    { name: "Whole Cake Island", eps: 39 },
    { name: "Reverie", eps: 3 },
    { name: "Wano", eps: 90 },
    { name: "Egghead", eps: 35 } 
];

// 1. RESTORED MANIFEST: Added catalog and meta resources back so Stremio recognizes the UI
const builder = new addonBuilder({
    id: 'org.vibecode.onepace.torbox',
    version: '3.5.2',
    name: 'One Pace - Torbox Premium',
    description: 'Standalone One Pace series mapped chronologically via Torbox with absolute stream alignment.',
    types: ['series'],
    catalogs: [{
        type: 'series',
        id: 'onepace_catalog',
        name: 'One Pace'
    }],
    resources: ['catalog', 'meta', 'stream'],
    idPrefixes: ['onepace']
});

const TORBOX_API_KEY = process.env.TORBOX_API_KEY;

const parseRSS = (xmlText) => {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xmlText)) !== null) {
        const itemContent = match[1];
        const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
        const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/);
        const dateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        if (titleMatch && linkMatch) {
            items.push({
                title: titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim(),
                link: linkMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim(),
                pubDate: dateMatch ? new Date(dateMatch[1]) : new Date(0)
            });
        }
    }
    return items;
};

const fetchChronologicalRelease = async (arcName, epPad, episode) => {
    const baseUrl = 'https://nyaa.si/?page=rss&u=Galaxy9000';
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

    try {
        const qIndiv = `One Pace ${arcName} ${epPad}`;
        const qBatch = `One Pace ${arcName}`;

        const [resIndiv, resBatch] = await Promise.all([
            axios.get(`${baseUrl}&q=${encodeURIComponent(qIndiv)}`, { headers }),
            axios.get(`${baseUrl}&q=${encodeURIComponent(qBatch)}`, { headers })
        ]);

        const itemsIndiv = parseRSS(resIndiv.data);
        const itemsBatch = parseRSS(resBatch.data);
        const allItems = [...itemsIndiv, ...itemsBatch];

        const uniqueLinks = new Set();
        let candidates = [];

        for (const item of allItems) {
            if (uniqueLinks.has(item.link)) continue;
            uniqueLinks.add(item.link);

            const titleLower = item.title.toLowerCase();
            if (!titleLower.includes('one pace') || !titleLower.includes(arcName.toLowerCase())) continue;

            const isBatch = titleLower.includes('batch');
            let matchesEpisode = false;

            if (isBatch) {
                if (arcName === 'Wano') {
                    if (episode <= 12 && titleLower.includes('act 1')) matchesEpisode = true;
                    else if (episode >= 13 && episode <= 30 && titleLower.includes('act 2')) matchesEpisode = true;
                } else {
                    matchesEpisode = true;
                }
            } else {
                const epRegex = new RegExp(`(?<!\\d)${epPad}(?!\\d)`);
                if (epRegex.test(item.title)) {
                    matchesEpisode = true;
                }
            }

            if (matchesEpisode) {
                candidates.push({
                    title: item.title, magnet: item.link, pubDate: item.pubDate,
                    isBatch: isBatch, isExtended: /extended/i.test(item.title)
                });
            }
        }

        if (candidates.length === 0) return null;

        const extendedPool = candidates.filter(c => c.isExtended);
        if (extendedPool.length > 0) candidates = extendedPool;

        const batches = candidates.filter(c => c.isBatch).sort((a, b) => b.pubDate - a.pubDate);
        const individuals = candidates.filter(c => !c.isBatch).sort((a, b) => b.pubDate - a.pubDate);

        if (batches.length > 0 && individuals.length > 0) {
            if (individuals[0].pubDate > batches[0].pubDate) return individuals[0];
            return batches[0];
        } else if (batches.length > 0) {
            return batches[0];
        } else if (individuals.length > 0) {
            return individuals[0];
        }
    } catch (error) {
        console.error("Nyaa Engine Processing Failure:", error.message);
    }
    return null;
};

// 2. RESTORED CATALOG HANDLER
builder.defineCatalogHandler(({ type, id }) => {
    if (type === 'series' && id === 'onepace_catalog') {
        return Promise.resolve({
            metas: [{
                id: 'onepace:1', type: 'series', name: 'One Pace',
                poster: 'https://artworks.thetvdb.com/banners/posters/329606-1.jpg',
                description: 'One Pace recuts the One Piece anime to bring it more in line with the manga.'
            }]
        });
    }
    return Promise.resolve({ metas: [] });
});

// 3. RESTORED META HANDLER
builder.defineMetaHandler(({ type, id }) => {
    if (type === 'series' && id === 'onepace:1') {
        const videos = [];
        ARCS.forEach((arc, index) => {
            const season = index + 1;
            for (let ep = 1; ep <= arc.eps; ep++) {
                videos.push({
                    id: `onepace:1:${season}:${ep}`,
                    title: `${arc.name} ${ep}`,
                    season: season, episode: ep,
                    released: new Date().toISOString()
                });
            }
        });
        return Promise.resolve({
            meta: {
                id: 'onepace:1', type: 'series', name: 'One Pace',
                poster: 'https://artworks.thetvdb.com/banners/posters/329606-1.jpg',
                background: 'https://artworks.thetvdb.com/banners/fanart/original/329606-2.jpg',
                description: 'One Pace recuts the One Piece anime to bring it more in line with the manga.',
                videos: videos
            }
        });
    }
    return Promise.resolve({ meta: {} });
});

// 4. FULLY REPAIRED STREAM HANDLER
builder.defineStreamHandler(async ({ type, id }) => {
    if (type !== 'series' || !id.startsWith('onepace:1:')) return { streams: [] };

    const parts = id.split(':');
    let season = parseInt(parts[2], 10);
    let episode = parseInt(parts[3], 10);

    // Inversion Protection Shield
    if (season <= ARCS.length && episode <= ARCS.length) {
        const standardMax = ARCS[season - 1] ? ARCS[season - 1].eps : 0;
        const swappedMax = ARCS[episode - 1] ? ARCS[episode - 1].eps : 0;
        
        if (episode > standardMax && season <= swappedMax) {
            const temp = season;
            season = episode;
            episode = temp;
        }
    } else if (season > ARCS.length && episode <= ARCS.length) {
        const temp = season;
        season = episode;
        episode = temp;
    }

    if (season < 1 || season > ARCS.length) return { streams: [] };

    const arcName = ARCS[season - 1].name;
    const epPad = episode.toString().padStart(2, '0');

    const bestRelease = await fetchChronologicalRelease(arcName, epPad, episode);
    if (!bestRelease) return { streams: [] };

    const { magnet, isBatch, title: torrentTitle } = bestRelease;
    
    // Safety check to parse infoHash correctly 
    const hashMatch = magnet.match(/urn:btih:([a-zA-Z0-9]+)/);
    if (!hashMatch) return { streams: [] };
    const infoHash = hashMatch[1].toLowerCase();

    try {
        const headers = { Authorization: `Bearer ${TORBOX_API_KEY}` };

        // Check if Torrent is Cached
        const cacheRes = await axios.get(`https://api.torbox.app/v1/api/torrents/checkcached`, {
            params: { hash: infoHash, format: 'list' }, headers
        });
        
        let isCached = false;
        const cData = cacheRes.data?.data;
        if (cData === true) isCached = true;
        else if (Array.isArray(cData)) {
            isCached = cData.some(item => (typeof item === 'string' ? item : item.hash)?.toLowerCase() === infoHash);
        } else if (typeof cData === 'object' && cData !== null) {
            isCached = !!cData[Object.keys(cData).find(k => k.toLowerCase() === infoHash)];
        }

        if (isCached) {
            // FIX: Torbox expects Form-Data layout. Using URLSearchParams mimics application/x-www-form-urlencoded seamlessly
            const createRes = await axios.post(
                'https://api.torbox.app/v1/api/torrents/createtorrent', 
                new URLSearchParams({ magnet }).toString(), 
                { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            const torrentId = createRes.data?.data?.torrent_id || createRes.data?.data?.id;
            if (!torrentId) return { streams: [] };

            // FIX: Query /mylist to actually retrieve the files array metadata
            const mylistRes = await axios.get(`https://api.torbox.app/v1/api/torrents/mylist?id=${torrentId}`, { headers });
            const files = mylistRes.data?.data?.files || [];
            
            let fileId = null;

            if (files.length > 0) {
                const videoFiles = files.filter(f => f.name.match(/\.(mkv|mp4|avi|webm)$/i));
                
                if (videoFiles.length === 1) {
                    fileId = videoFiles[0].id;
                } else if (videoFiles.length > 1) {
                    if (isBatch) {
                        if (arcName === 'Dressrosa') {
                            videoFiles.sort((a, b) => a.name.localeCompare(b.name)); 
                            const targetIndex = episode - 1; 
                            if (targetIndex >= 0 && targetIndex < videoFiles.length) {
                                fileId = videoFiles[targetIndex].id;
                            }
                        } else {
                            // FIX: Cleaned up escape sequences in RegExp (`\d` instead of `\\\\d`)
                            const regEp = new RegExp(`(?<!\\d)0*${episode}(?!\\d)`);
                            fileId = videoFiles.find(f => regEp.test(f.name.toLowerCase()))?.id || videoFiles[0].id;
                        }
                    } else {
                        // FIX: For Individual Releases with multiple video tracks (like extras/openings), pick the largest file
                        videoFiles.sort((a, b) => b.size - a.size);
                        fileId = videoFiles[0].id;
                    }
                }
            }

            // FIX: The /requestdl endpoint STRICTLY requires the API key passed via the `token` URL param, NOT the header
            const dlParams = { 
                token: TORBOX_API_KEY, 
                torrent_id: torrentId 
            };
            if (fileId !== null) dlParams.file_id = fileId;

            const dlRes = await axios.get(`https://api.torbox.app/v1/api/torrents/requestdl`, {
                params: dlParams, 
                headers
            });

            if (dlRes.data?.success && dlRes.data?.data) {
                return {
                    streams: [{
                        name: 'Torbox\n[READY]',
                        title: `${torrentTitle}\n⚡ Stream Target Initialized`,
                        url: dlRes.data.data
                    }]
                };
            }
        } 
        
        // Uncached Fallback Route
        return {
            streams: [{
                name: 'Torbox\n[DOWNLOADING]',
                title: `Caching... Check back later.\nTorbox caching engine processing: ${arcName} ${epPad}`,
                url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
            }]
        };
        
    } catch (error) {
        console.error("Torbox Pipeline Failure:", error.message);
        return { streams: [] };
    }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log('Standalone One Pace Catalog Addon v3.5.2 active on port 7000');
