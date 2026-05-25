const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

const ARCS = [
    "Romance Dawn", "Orange Town", "Syrup Village", "Gaimon",
    "Baratie", "Arlong Park", "The Adventures of Buggy's Crew",
    "Loguetown", "Reverse Mountain", "Whiskey Peak", "The Trials of Koby-Meppo",
    "Little Garden", "Drum Island", "Arabasta", "Jaya", "Skypiea",
    "Long Ring Long Land", "Water Seven", "Enies Lobby", "Post-Enies Lobby",
    "Thriller Bark", "Sabaody Archipelago", "Amazon Lily", "Impel Down",
    "If You Could Go Anywhere... The Adventures of the Straw Hats", "Marineford",
    "Post-War", "Return to Sabaody", "Fishman Island", "Punk Hazard",
    "Dressrosa", "Zou", "Whole Cake Island", "Reverie", "Wano", "Egghead"
];

const builder = new addonBuilder({
    id: 'org.vibecode.onepace.torbox',
    version: '2.2.0',
    name: 'One Pace - Torbox Elite',
    description: 'Streams One Pace from Nyaa via Torbox using chronological priority mapping.',
    types: ['series'],
    catalogs: [],
    resources: ['stream'],
    idPrefixes: ['tt0388629']
});

const TORBOX_API_KEY = process.env.TORBOX_API_KEY;

// RSS Parser tracking title, magnet links, and absolute publication dates
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

// Chronological Priority Engine
const fetchChronologicalRelease = async (arcName, epPad) => {
    const baseUrl = 'https://nyaa.si/?page=rss&u=Galaxy9000';
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

    try {
        const qIndiv = `"One Pace" "${arcName} ${epPad}"`;
        const qBatch = `"One Pace" "${arcName}"`;

        // Parallelize both network calls to protect Stremio timeout tolerances
        const [resIndiv, resBatch] = await Promise.all([
            axios.get(`${baseUrl}&q=${encodeURIComponent(qIndiv)}`, { headers }),
            axios.get(`${baseUrl}&q=${encodeURIComponent(qBatch)}`, { headers })
        ]);

        const itemsIndiv = parseRSS(resIndiv.data);
        const itemsBatch = parseRSS(resBatch.data);

        let candidates = [];

        // 1. Process Individual Episode Hits
        for (const item of itemsIndiv) {
            candidates.push({
                title: item.title,
                magnet: item.link,
                pubDate: item.pubDate,
                isBatch: false,
                isExtended: /extended/i.test(item.title)
            });
        }

        // 2. Process Structural Batch Matches
        const escapedArc = arcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Structural validation prevents single episode deviations (Gaimon 01) from matching as a batch
        const batchRegex = new RegExp(`\\[One\\s+Pace\\]\\[\\d+[-迎,\\d]*\\]\\s*${escapedArc}\\s*\\[`, 'i');

        for (const item of itemsBatch) {
            if (batchRegex.test(item.title)) {
                candidates.push({
                    title: item.title,
                    magnet: item.link,
                    pubDate: item.pubDate,
                    isBatch: true,
                    isExtended: /extended/i.test(item.title)
                });
            }
        }

        if (candidates.length === 0) return null;

        // RULE 1: Extended Releases take absolute priority. Filter out everything else if found.
        const extendedPool = candidates.filter(c => c.isExtended);
        if (extendedPool.length > 0) {
            candidates = extendedPool;
        }

        // Separate and sort candidate categories dynamically by date descending (Newest First)
        const batches = candidates.filter(c => c.isBatch).sort((a, b) => b.pubDate - a.pubDate);
        const individuals = candidates.filter(c => !c.isBatch).sort((a, b) => b.pubDate - a.pubDate);

        if (batches.length > 0 && individuals.length > 0) {
            // RULE 2: Use Batch default UNLESS an individual release has a newer timestamp
            if (individuals[0].pubDate > batches[0].pubDate) {
                return individuals[0]; // Newest individual re-release overrides older Batch
            } else {
                return batches[0]; // Batch contains newer/equal encoding fixes
            }
        } else if (batches.length > 0) {
            return batches[0];
        } else if (individuals.length > 0) {
            return individuals[0];
        }

    } catch (error) {
        console.error("Nyaa Chrono Processing Error:", error.message);
    }
    return null;
};

builder.defineStreamHandler(async ({ type, id }) => {
    if (type !== 'series' || !id.startsWith('tt0388629')) return { streams: [] };

    const [, seasonStr, episodeStr] = id.split(':');
    const season = parseInt(seasonStr, 10);
    const episode = parseInt(episodeStr, 10);

    if (season < 1 || season > ARCS.length) return { streams: [] };

    const arcName = ARCS[season - 1];
    const epPad = episode.toString().padStart(2, '0');

    // Run custom sorting logic
    const bestRelease = await fetchChronologicalRelease(arcName, epPad);
    if (!bestRelease) return { streams: [] };

    const { magnet, isBatch, title: torrentTitle } = bestRelease;
    const infoHash = magnet.match(/urn:btih:([a-zA-Z0-9]+)/)?.[1]?.toLowerCase();
    if (!infoHash) return { streams: [] };

    try {
        const headers = { Authorization: `Bearer ${TORBOX_API_KEY}` };

        const cacheRes = await axios.get(`https://api.torbox.app/v1/api/torrents/checkcached`, {
            params: { hash: infoHash, format: 'list' },
            headers
        });
        
        const isCached = cacheRes.data?.data === true || 
                         cacheRes.data?.data?.[infoHash] === true || 
                         (Array.isArray(cacheRes.data?.data) && cacheRes.data.data.includes(infoHash));

        const createRes = await axios.post('https://api.torbox.app/v1/api/torrents/createtorrent', 
            { magnet },
            { headers }
        );

        if (!createRes.data || !createRes.data.success) return { streams: [] };

        const torrentId = createRes.data.data.torrent_id;

        if (isCached) {
            let fileId = null;
            const torrentData = createRes.data?.data;
            
            if (isBatch && torrentData?.files && torrentData.files.length > 0) {
                const fileMatch = torrentData.files.find(f => {
                    const name = f.name.toLowerCase();
                    return name.includes(` ${epPad} `) || name.includes(`${epPad}.mkv`) || name.includes(`_${epPad}`);
                });
                if (fileMatch) fileId = fileMatch.id;
            }

            const dlParams = { torrent_id: torrentId };
            if (fileId) dlParams.file_id = fileId;

            const dlRes = await axios.get(`https://api.torbox.app/v1/api/torrents/requestdl`, {
                params: dlParams,
                headers
            });

            if (dlRes.data?.success) {
                return {
                    streams: [{
                        name: 'Torbox\n[READY]',
                        title: `${torrentTitle}\n⚡ Stream Target Initialized`,
                        url: dlRes.data.data
                    }]
                };
            }
        } else {
            return {
                streams: [{
                    name: 'Torbox\n[DOWNLOADING]',
                    title: `Caching... Check back later.\nTorbox caching engine processing: ${arcName} ${epPad}`,
                    url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
                }]
            };
        }
    } catch (error) {
        console.error("Torbox Pipeline Failure:", error.message);
        return { streams: [] };
    }

    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log('Chronological Priority Addon active on port 7000');
