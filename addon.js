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

const builder = new addonBuilder({
    id: 'org.vibecode.onepace.torbox',
    version: '4.1.0',
    name: 'One Pace - Torbox Premium',
    description: 'Standalone One Pace series. Automatically serves the newest Standard release alongside Extended/G8 alternative cuts.',
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

const getMatchingReleases = async (arcName, episode) => {
    const baseUrl = 'https://nyaa.si/?page=rss&u=Galaxy9000';
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
    const epPad = episode.toString().padStart(2, '0');

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
        const matchedReleases = [];

        for (const item of allItems) {
            if (uniqueLinks.has(item.link)) continue;
            uniqueLinks.add(item.link);

            const titleLower = item.title.toLowerCase();
            if (!titleLower.includes('one pace') || !titleLower.includes(arcName.toLowerCase())) continue;

            let cleanTitle = item.title
                .replace(/\[[a-fA-F0-9]{8}\]/g, '')               
                .replace(/\b(2160|1080|720|480|576)[pP]?\b/g, '')  
                .replace(/\b10bit\b/gi, '')
                .replace(/\bx26[45]\b/gi, '')
                .replace(/\bv\d\b/gi, '')                         
                .replace(/\bg\d+\b/gi, '');                        

            const rangeMatch = cleanTitle.match(/(?<!\d)(\d{1,3})\s*-\s*(\d{1,3})(?!\d)/);
            let matchesEpisode = false;
            let isBatch = false;

            if (rangeMatch) {
                isBatch = true;
                const start = parseInt(rangeMatch[1], 10);
                const end = parseInt(rangeMatch[2], 10);
                if (episode >= start && episode <= end) {
                    matchesEpisode = true;
                }
            } else {
                const standaloneNumbers = [];
                const numRegex = /(?<!\d)(\d{1,3})(?!\d)/g;
                let m;
                while ((m = numRegex.exec(cleanTitle)) !== null) {
                    standaloneNumbers.push(parseInt(m[1], 10));
                }

                if (standaloneNumbers.length > 0) {
                    if (standaloneNumbers.includes(episode)) {
                        matchesEpisode = true;
                    }
                } else {
                    isBatch = true;
                    matchesEpisode = true;
                }
            }

            if (matchesEpisode && arcName.toLowerCase() === 'wano' && isBatch) {
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

    const arcName = ARCS[season - 1].name;
    const epPad = episode.toString().padStart(2, '0');

    const matchingReleases = await getMatchingReleases(arcName, episode);
    if (matchingReleases.length === 0) return { streams: [] };

    // Targeted Stream Selection Logic
    let bestNormal = null;
    let bestAlt = null;

    for (const release of matchingReleases) {
        if (release.isG8 || release.isExtended) {
            if (!bestAlt) bestAlt = release;
        } else {
            if (!bestNormal) bestNormal = release;
        }
        if (bestNormal && bestAlt) break; // We have filled both slots
    }

    const targetedReleases = [];
    if (bestNormal) targetedReleases.push(bestNormal);
    if (bestAlt) targetedReleases.push(bestAlt);

    const streams = [];

    // Process our strictly segregated releases
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
                    const videoFiles = files.filter(f => f.name.match(/\.(mkv|mp4|avi|webm)$/i
