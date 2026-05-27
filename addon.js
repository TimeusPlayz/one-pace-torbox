const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

// Decoupled Arc Map
const ARCS = [
    { name: "Romance Dawn", eps: 4, q: "Romance Dawn", m: ["romance dawn"] },
    { name: "Orange Town", eps: 3, q: "Orange Town", m: ["orange town"] },
    { name: "Syrup Village", eps: 7, q: "Syrup Village", m: ["syrup village"] },
    { name: "Gaimon", eps: 1, q: "Gaimon", m: ["gaimon"] },
    { name: "Baratie", eps: 8, q: "Baratie", m: ["baratie"] },
    { name: "Arlong Park", eps: 10, q: "Arlong Park", m: ["arlong park"] },
    { name: "The Adventures of Buggy's Crew", eps: 1, q: "Buggy", m: ["buggy", "buggy's crew"] },
    { name: "Loguetown", eps: 3, q: "Loguetown", m: ["loguetown"] },
    { name: "Reverse Mountain", eps: 2, q: "Reverse Mountain", m: ["reverse mountain"] },
    // FIX 1: Optimized query to "Whisk" to grab both "Whisky" and "Whiskey" variations
    { name: "Whiskey Peak", eps: 2, q: "Whisk", m: ["whisky peak", "whiskey peak"] },
    { name: "The Trials of Koby-Meppo", eps: 1, q: "Koby", m: ["koby", "koby-meppo", "meppo"] },
    { name: "Little Garden", eps: 5, q: "Little Garden", m: ["little garden"] },
    { name: "Drum Island", eps: 8, q: "Drum Island", m: ["drum island"] },
    { name: "Arabasta", eps: 21, q: "Arabasta", m: ["arabasta", "alabasta"] },
    { name: "Jaya", eps: 8, q: "Jaya", m: ["jaya"] },
    { name: "Skypiea", eps: 25, q: "Skypiea", m: ["skypiea"] },
    { name: "Long Ring Long Land", eps: 6, q: "Long Ring", m: ["long ring", "davy back"] },
    { name: "Water Seven", eps: 20, q: "Water Seven", m: ["water seven", "water 7"] },
    { name: "Enies Lobby", eps: 25, q: "Enies Lobby", m: ["enies lobby"] },
    { name: "Post-Enies Lobby", eps: 5, q: "Post-Enies", m: ["post-enies", "post enies"] },
    { name: "Thriller Bark", eps: 22, q: "Thriller Bark", m: ["thriller bark"] },
    { name: "Sabaody Archipelago", eps: 11, q: "Sabaody", m: ["sabaody"] },
    { name: "Amazon Lily", eps: 5, q: "Amazon Lily", m: ["amazon lily"] },
    { name: "Impel Down", eps: 10, q: "Impel Down", m: ["impel down"] },
    { name: "If You Could Go Anywhere... The Adventures of the Straw Hats", eps: 1, q: "Straw Hats", m: ["straw hats", "straw hat stories", "adventures", "anywhere"] },
    { name: "Marineford", eps: 17, q: "Marineford", m: ["marineford"] },
    { name: "Post-War", eps: 8, q: "Post-War", m: ["post-war", "post war"] },
    { name: "Return to Sabaody", eps: 3, q: "Return to Sabaody", m: ["return to sabaody"] },
    { name: "Fishman Island", eps: 24, q: "Fishman Island", m: ["fishman island"] },
    { name: "Punk Hazard", eps: 22, q: "Punk Hazard", m: ["punk hazard"] },
    { name: "Dressrosa", eps: 48, q: "Dressrosa", m: ["dressrosa"] },
    { name: "Zou", eps: 10, q: "Zou", m: ["zou"] },
    { name: "Whole Cake Island", eps: 39, q: "Whole Cake", m: ["whole cake"] },
    { name: "Reverie", eps: 3, q: "Reverie", m: ["reverie"] },
    { name: "Wano", eps: 86, q: "Wano", m: ["wano"] },
    { name: "Egghead", eps: 35, q: "Egghead", m: ["egghead"] } 
];

const builder = new addonBuilder({
    id: 'org.vibecode.onepace.torbox',
    version: '4.3.3',
    name: 'One Pace - Torbox Premium',
    description: 'Standalone One Pace series. Complete site-wide legacy arc coverage with standard & alternate stream slot logic.',
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
        const hashMatch = itemContent.match(/<nyaa:infoHash>([\s\S]*?)<\/nyaa:infoHash>/);
        const dateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        
        if (titleMatch && hashMatch) {
            const title = titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
            const infoHash = hashMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim().toLowerCase();
            
            items.push({
                title: title,
                link: `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}`,
                pubDate: dateMatch ? new Date(dateMatch[1]) : new Date(0)
            });
        }
    }
    return items;
};

const getMatchingReleases = async (arc, episode) => {
    const baseUrl = 'https://nyaa.si/?page=rss'; 
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
    const epPad = episode.toString().padStart(2, '0');

    try {
        const qIndiv = `Pace ${arc.q} ${epPad}`;
        const qBatch = `Pace ${arc.q}`;

        let allItems = [];

        try {
            const resBatch = await axios.get(`${baseUrl}&q=${encodeURIComponent(qBatch)}`, { headers });
            allItems.push(...parseRSS(resBatch.data));
        } catch (e) {
            console.error(`Batch fetch failed: ${e.message}`);
        }

        await new Promise(r => setTimeout(r, 600)); 

        try {
            const resIndiv = await axios.get(`${baseUrl}&q=${encodeURIComponent(qIndiv)}`, { headers });
            allItems.push(...parseRSS(resIndiv.data));
        } catch (e) {
            console.error(`Indiv fetch failed: ${e.message}`);
        }

        const uniqueLinks = new Set();
        const matchedReleases = [];

        for (const item of allItems) {
            if (uniqueLinks.has(item.link)) continue;
            uniqueLinks.add(item.link);

            const titleLower = item.title.toLowerCase();
            if (!titleLower.includes('one pace') && !titleLower.includes('onepace')) continue;
            
            const matchesArcName = arc.m.some(term => titleLower.includes(term));
            if (!matchesArcName) continue;

            let cleanTitle = item.title
                .replace(/\[[a-fA-F0-9]{8}\]/g, '')               
                .replace(/[\(\[][\d\s\-~,&]+[\)\]]/g, '')         
                .replace(/\b(2160|1080|720|480|576)[pP]?\b/g, '')  
                .replace(/\b10bit\b/gi, '')
                .replace(/\bx26[45]\b/gi, '')
                .replace(/v\d{1,2}\b/gi, '')                        
                .replace(/\bg\d+\b/gi, '')
                .replace(/\[?one\s*pace\]?/gi, '')
                .replace(/\b(act|part|batch|vol|chapter|ch)\s*\d+\b/gi, ''); 

            const rangeMatch = cleanTitle.match(/(?<!\d)(\d{1,3})\s*[-~]\s*(\d{1,3})(?!\d)/);
            let matchesEpisode = false;
            let isBatch = false;

            if (rangeMatch) {
                const start = parseInt(rangeMatch[1], 10);
                const end = parseInt(rangeMatch[2], 10);
                
                // FIX 2: Detect if the range represents manga chapters (e.g., 106-114) instead of One Pace episode counts.
                if (start > arc.eps) {
                    isBatch = true;
                    matchesEpisode = true; // Fallback: Treat as a macro arc batch
                } else {
                    isBatch = true;
                    if (episode >= start && episode <= end) {
                        matchesEpisode = true;
                    }
                }
            } else {
                const standaloneNumbers = [];
                const numRegex = /(?<!\d)(\d{1,3})(?!\d)/g;
                let m;
                while ((m = numRegex.exec(cleanTitle)) !== null) {
                    standaloneNumbers.push(parseInt(m[1], 10));
                }

                // FIX 3: Ignore stray absolute anime episode / manga chapter numbers when matching standalone counts
                const validPaceNumbers = standaloneNumbers.filter(num => num <= arc.eps);

                if (validPaceNumbers.length > 0) {
                    if (validPaceNumbers.includes(episode)) {
                        matchesEpisode = true;
                    }
                } else {
                    isBatch = true;
                    matchesEpisode = true;
                }
            }

            if (matchesEpisode && arc.name.toLowerCase() === 'wano' && isBatch) {
                if (titleLower.includes('act 1') && episode > 12) matchesEpisode = false;
                if (titleLower.includes('act 2') && (episode < 13 || episode > 30)) matchesEpisode = false;
            }

            if (matchesEpisode) {
                matchedReleases.push({
                    title: item.title,
                    magnet: item.link,
                    pubDate: item.pubDate,
                    isBatch: isBatch,
                    isG8: /g8/i.test(item.title),
                    isExtended: /extended/i.test(item.title)
                });
            }
        }

        return matchedReleases.sort((a, b) => b.pubDate - a.pubDate);
    } catch (error) {
        console.error("Nyaa Engine Processing Failure:", error.message);
        return [];
    }
};

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

builder.defineStreamHandler(async ({ type, id }) => {
    if (type !== 'series' || !id.startsWith('onepace:1:')) return { streams: [] };

    const parts = id.split(':');
    let season = parseInt(parts[2], 10);
    let episode = parseInt(parts[3], 10);

    if (season <= ARCS.length && episode <= ARCS.length) {
        const standardMax = ARCS[season - 1] ? ARCS[season - 1].eps : 0;
        const swappedMax = ARCS[episode - 1] ? ARCS[episode - 1].eps : 0;
        if (episode > standardMax && season <= swappedMax) {
            [season, episode] = [episode, season];
        }
    } else if (season > ARCS.length && episode <= ARCS.length) {
        [season, episode] = [episode, season];
    }

    if (season < 1 || season > ARCS.length) return { streams: [] };

    const arcObj = ARCS[season - 1];
    const arcName = arcObj.name;

    const matchingReleases = await getMatchingReleases(arcObj, episode);
    if (matchingReleases.length === 0) return { streams: [] };

    let bestNormal = null;
    let bestAlt = null;

    for (const release of matchingReleases) {
        if (release.isG8 || release.isExtended) {
            if (!bestAlt) bestAlt = release;
        } else {
            if (!bestNormal) bestNormal = release;
        }
        if (bestNormal && bestAlt) break; 
    }

    const targetedReleases = [];
    if (bestNormal) targetedReleases.push(bestNormal);
    if (bestAlt) targetedReleases.push(bestAlt);

    const streams = [];

    for (const release of targetedReleases) {
        const { magnet, isBatch, title: torrentTitle } = release;
        const hashMatch = magnet.match(/urn:btih:([a-zA-Z0-9]+)/);
        if (!hashMatch) continue;
        const infoHash = hashMatch[1].toLowerCase();

        try {
            const headers = { Authorization: `Bearer ${TORBOX_API_KEY}` };
            const cacheRes = await axios.get(`https://api.torbox.app/v1/api/torrents/checkcached`, {
                params: { hash: infoHash, format: 'list' }, headers
            });
            
            let isCached = false;
            const cData = cacheRes.data?.data;
            if (cData === true) isCached = true;
            else if (Array.isArray(cData)) {
                isCached = cData.some(item => (typeof item === 'string' ? item : (item.hash || item.info_hash || '')).toLowerCase() === infoHash);
            } else if (typeof cData === 'object' && cData !== null) {
                isCached = !!cData[Object.keys(cData).find(k => k.toLowerCase() === infoHash)];
            }

            let tag = "READY";
            const badges = [];
            if (release.isG8) badges.push("G8 CUT");
            else if (release.isExtended) badges.push("EXTENDED");
            else badges.push("STANDARD");

            if (release.isBatch) badges.push("BATCH");
            if (badges.length > 0) tag += ` - ${badges.join(" | ")}`;

            if (isCached) {
                const createRes = await axios.post(
                    'https://api.torbox.app/v1/api/torrents/createtorrent', 
                    new URLSearchParams({ magnet }).toString(), 
                    { 
                        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
                        validateStatus: () => true
                    }
                );

                let torrentId = createRes.data?.data?.torrent_id || createRes.data?.data?.id;
                if (!torrentId) {
                    const listAllRes = await axios.get('https://api.torbox.app/v1/api/torrents/mylist', { headers });
                    const allTorrents = listAllRes.data?.data || [];
                    const matchingTorrent = allTorrents.find(t => (t.hash || t.info_hash || '').toLowerCase() === infoHash);
                    if (matchingTorrent) torrentId = matchingTorrent.id || matchingTorrent.torrent_id;
                }

                if (!torrentId) continue;

                const mylistRes = await axios.get(`https://api.torbox.app/v1/api/torrents/mylist?id=${torrentId}`, { headers });
                const rawData = mylistRes.data?.data;
                const torrentInfo = Array.isArray(rawData) ? rawData[0] : rawData;
                const files = torrentInfo?.files || [];
                
                let fileId = null;

                if (files.length > 0) {
                    const videoFiles = files.filter(f => 
                        f.name.match(/\.(mkv|mp4|avi|webm)$/i) &&
                        !f.name.match(/(NCED|NCOP|Creditless|Trailer|Promo|Bonus)/i)
                    );
                    
                    if (videoFiles.length === 1) {
                        fileId = videoFiles[0].id;
                    } else if (videoFiles.length > 1) {
                        if (isBatch) {
                            if (arcName === 'Dressrosa') {
                                videoFiles.sort((a, b) => a.name.localeCompare(b.name)); 
                                const targetIndex = episode - 1; 
                                if (targetIndex >= 0 && targetIndex < videoFiles.length) fileId = videoFiles[targetIndex].id;
                            } else {
                                const regEp = new RegExp("(?<!\\d)0*" + episode + "(?!\\d)");
                                const matchedFile = videoFiles.find(f => {
                                    const cleanFileName = f.name
                                        .replace(/\[[a-fA-F0-9]{8}\]/g, '')
                                        .replace(/[\(\[][\d\s\-~,&]+[\)\]]/g, '')
                                        .replace(/\b(2160|1080|720|480|576)[pP]?\b/g, '')
                                        .replace(/\b10bit\b/gi, '')
                                        .replace(/\bx26[45]\b/gi, '')
                                        .replace(/v\d{1,2}\b/gi, '') 
                                        .replace(/\bg\d+\b/gi, '')
                                        .replace(/\[?one\s*pace\]?/gi, '')
                                        .replace(/\b(act|part|batch|vol|chapter|ch)\s*\d+\b/gi, ''); 
                                    return regEp.test(cleanFileName);
                                });
                                fileId = matchedFile ? matchedFile.id : videoFiles[0].id;
                            }
                        } else {
                            videoFiles.sort((a, b) => b.size - a.size);
                            fileId = videoFiles[0].id;
                        }
                    }
                }

                const dlParams = { token: TORBOX_API_KEY, torrent_id: torrentId };
                if (fileId !== null) dlParams.file_id = fileId;

                const dlRes = await axios.get(`https://api.torbox.app/v1/api/torrents/requestdl`, {
                    params: dlParams, headers
                });

                if (dlRes.data?.success && dlRes.data?.data) {
                    streams.push({
                        name: `Torbox\n[${tag}]`,
                        title: `${torrentTitle}\n⚡ Stream Ready`,
                        url: dlRes.data.data
                    });
                }
            } else {
                axios.post(
                    'https://api.torbox.app/v1/api/torrents/createtorrent',
                    new URLSearchParams({ magnet }).toString(),
                    { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true }
                ).catch(() => {});

                let slowTag = "DOWNLOADING";
                if (badges.length > 0) slowTag += ` - ${badges.join(" | ")}`;

                streams.push({
                    name: `Torbox\n[${slowTag}]`,
                    title: `Caching... Check back later.\nProcessing release: ${torrentTitle}`,
                    url: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
                });
            }
        } catch (error) {
            console.error(`Torbox Pipeline Failure for ${torrentTitle}:`, error.message);
        }
    }

    return { streams };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log('One Pace Torbox Addon v4.3.3 active on port 7000');
