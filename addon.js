const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

// Upgraded ARCS with dedicated Nyaa search queries (q) and matching alias arrays (m)
const ARCS = [
    { name: "Romance Dawn", eps: 4, q: "Romance Dawn", m: ["romance dawn"] },
    { name: "Orange Town", eps: 3, q: "Orange Town", m: ["orange town"] },
    { name: "Syrup Village", eps: 7, q: "Syrup Village", m: ["syrup village"] },
    { name: "Gaimon", eps: 1, q: "Gaimon", m: ["gaimon"] },
    { name: "Baratie", eps: 9, q: "Baratie", m: ["baratie"] },
    { name: "Arlong Park", eps: 10, q: "Arlong Park", m: ["arlong park"] },
    { name: "The Adventures of Buggy's Crew", eps: 1, q: "Buggy", m: ["buggy", "buggy's crew"] },
    { name: "Loguetown", eps: 3, q: "Loguetown", m: ["loguetown"] },
    { name: "Reverse Mountain", eps: 2, q: "Reverse Mountain", m: ["reverse mountain"] },
    { name: "Whiskey Peak", eps: 2, q: "Whiskey Peak", m: ["whiskey peak", "whisky peak"] },
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
    { name: "If You Could Go Anywhere... The Adventures of the Straw Hats", eps: 1, q: "Straw Hats", m: ["straw hats", "anywhere"] },
    { name: "Marineford", eps: 17, q: "Marineford", m: ["marineford"] },
    { name: "Post-War", eps: 8, q: "Post-War", m: ["post-war", "post war"] },
    { name: "Return to Sabaody", eps: 3, q: "Return to Sabaody", m: ["return to sabaody"] },
    { name: "Fishman Island", eps: 24, q: "Fishman Island", m: ["fishman island"] },
    { name: "Punk Hazard", eps: 22, q: "Punk Hazard", m: ["punk hazard"] },
    { name: "Dressrosa", eps: 48, q: "Dressrosa", m: ["dressrosa"] },
    { name: "Zou", eps: 10, q: "Zou", m: ["zou"] },
    { name: "Whole Cake Island", eps: 39, q: "Whole Cake", m: ["whole cake"] },
    { name: "Reverie", eps: 3, q: "Reverie", m: ["reverie"] },
    { name: "Wano", eps: 90, q: "Wano", m: ["wano"] },
    { name: "Egghead", eps: 35, q: "Egghead", m: ["egghead"] }
];

const builder = new addonBuilder({
    id: 'org.vibecode.onepace.torbox',
    version: '3.7.0',
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
        const titleMatch  = itemContent.match(/<title>([\s\S]*?)<\/title>/);
        const magnetMatch = itemContent.match(/<nyaa:magnet>([\s\S]*?)<\/nyaa:magnet>/);
        const dateMatch   = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

        if (titleMatch && magnetMatch) {
            items.push({
                title:   titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim(),
                link:    magnetMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim(),
                pubDate: dateMatch ? new Date(dateMatch[1]) : new Date(0)
            });
        }
    }
    return items;
};

const fetchChronologicalRelease = async (arc, epPad, episode) => {
    // FIX: Site-wide broad searching to simulate exactly what works for you manually
    const baseUrl = 'https://nyaa.si/?page=rss';
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

    try {
        const query = `One Pace ${arc.q}`;
        const response = await axios.get(`${baseUrl}&q=${encodeURIComponent(query)}`, { headers });
        const items = parseRSS(response.data);

        const uniqueLinks = new Set();
        let candidates    = [];

        for (const item of items) {
            if (uniqueLinks.has(item.link)) continue;
            uniqueLinks.add(item.link);

            const titleLower = item.title.toLowerCase();
            if (!titleLower.includes('one pace') && !titleLower.includes('onepace')) continue;

            // Alias Engine check
            const matchesArc = arc.m.some(alias => titleLower.includes(alias));
            if (!matchesArc) continue;

            // Strip out common metadata numbers to avoid false matching with episode numbers
            let cleanTitle = item.title
                .replace(/\[[a-fA-F0-9]{8}\]/g, '')               
                .replace(/\b(2160|1080|720|480|576)[pP]?\b/g, '')  
                .replace(/\b10bit\b/gi, '')
                .replace(/\bx26[45]\b/gi, '')
                .replace(/\bv\d\b/gi, '')                         
                .replace(/\bg\d+\b/gi, '');                        

            let matchesEpisode = false;
            let isBatch = titleLower.includes('batch') || titleLower.includes('complete') || titleLower.includes('act');

            // 1. Check for episode range strings (e.g., 01-04)
            const rangeMatch = cleanTitle.match(/(?<!\d)(\d{1,3})\s*[-~]\s*(\d{1,3})(?!\d)/);
            if (rangeMatch) {
                isBatch = true;
                const start = parseInt(rangeMatch[1], 10);
                const end = parseInt(rangeMatch[2], 10);
                if (episode >= start && episode <= end) matchesEpisode = true;
            } else {
                // 2. Identify remaining standalone numbers
                const standaloneNumbers = [];
                const numRegex = /(?<!\d)(\d{1,3})(?!\d)/g;
                let m;
                while ((m = numRegex.exec(cleanTitle)) !== null) {
                    standaloneNumbers.push(parseInt(m[1], 10));
                }

                if (standaloneNumbers.length > 0) {
                    if (standaloneNumbers.includes(episode)) matchesEpisode = true;
                } else {
                    // FIX: No numbers found at all implies it's a full complete arc release (Batch)
                    isBatch = true;
                    matchesEpisode = true;
                }
            }

            // Wano Act Splitting Logic Preservation
            if (arc.name === 'Wano' && isBatch) {
                matchesEpisode = false;
                if (episode <= 12 && titleLower.includes('act 1')) matchesEpisode = true;
                else if (episode >= 13 && episode <= 30 && titleLower.includes('act 2')) matchesEpisode = true;
                else if (episode >= 31 && titleLower.includes('act 3')) matchesEpisode = true;
                else if (!titleLower.includes('act 1') && !titleLower.includes('act 2') && !titleLower.includes('act 3')) matchesEpisode = true;
            }

            if (matchesEpisode) {
                candidates.push({
                    title:      item.title,
                    magnet:     item.link,
                    pubDate:    item.pubDate,
                    isBatch:    isBatch,
                    isExtended: /extended/i.test(item.title)
                });
            }
        }

        if (candidates.length === 0) return null;

        const extendedPool = candidates.filter(c => c.isExtended);
        if (extendedPool.length > 0) candidates = extendedPool;

        const batches     = candidates.filter(c =>  c.isBatch).sort((a, b) => b.pubDate - a.pubDate);
        const individuals = candidates.filter(c => !c.isBatch).sort((a, b) => b.pubDate - a.pubDate);

        if (batches.length > 0 && individuals.length > 0) {
            return individuals[0].pubDate > batches[0].pubDate ? individuals[0] : batches[0];
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

// CATALOG HANDLER
builder.defineCatalogHandler(({ type, id }) => {
    if (type === 'series' && id === 'onepace_catalog') {
        return Promise.resolve({
            metas: [{
                id:          'onepace:1',
                type:        'series',
                name:        'One Pace',
                poster:      'https://artworks.thetvdb.com/banners/posters/329606-1.jpg',
                description: 'One Pace recuts the One Piece anime to bring it more in line with the manga.'
            }]
        });
    }
    return Promise.resolve({ metas: [] });
});

// META HANDLER
builder.defineMetaHandler(({ type, id }) => {
    if (type === 'series' && id === 'onepace:1') {
        const videos = [];
        ARCS.forEach((arc, index) => {
            const season = index + 1;
            for (let ep = 1; ep <= arc.eps; ep++) {
                videos.push({
                    id:       `onepace:1:${season}:${ep}`,
                    title:    `${arc.name} ${ep}`,
                    season:   season,
                    episode:  ep,
                    released: new Date().toISOString()
                });
            }
        });
        return Promise.resolve({
            meta: {
                id:          'onepace:1',
                type:        'series',
                name:        'One Pace',
                poster:      'https://artworks.thetvdb.com/banners/posters/329606-1.jpg',
                background:  'https://artworks.thetvdb.com/banners/fanart/original/329606-2.jpg',
                description: 'One Pace recuts the One Piece anime to bring it more in line with the manga.',
                videos:      videos
            }
        });
    }
    return Promise.resolve({ meta: {} });
});

// STREAM HANDLER
builder.defineStreamHandler(async ({ type, id }) => {
    if (type !== 'series' || !id.startsWith('onepace:1:')) return { streams: [] };

    const parts = id.split(':');
    let season  = parseInt(parts[2], 10);
    let episode = parseInt(parts[3], 10);

    // Inversion Protection Shield
    if (season <= ARCS.length && episode <= ARCS.length) {
        const standardMax = ARCS[season - 1] ? ARCS[season - 1].eps : 0;
        const swappedMax  = ARCS[episode - 1] ? ARCS[episode - 1].eps : 0;
        if (episode > standardMax && season <= swappedMax) {
            [season, episode] = [episode, season];
        }
    } else if (season > ARCS.length && episode <= ARCS.length) {
        [season, episode] = [episode, season];
    }

    if (season < 1 || season > ARCS.length) return { streams: [] };

    const arc = ARCS[season - 1];
    const epPad   = episode.toString().padStart(2, '0');

    const bestRelease = await fetchChronologicalRelease(arc, epPad, episode);
    if (!bestRelease) {
        console.error(`No Nyaa release found for: ${arc.name} ${epPad}`);
        return { streams: [] };
    }

    const { magnet, isBatch, title: torrentTitle } = bestRelease;

    const hashMatch = magnet.match(/urn:btih:([a-zA-Z0-9]+)/i);
    if (!hashMatch) {
        console.error("Could not parse infoHash from magnet:", magnet);
        return { streams: [] };
    }
    const infoHash = hashMatch[1].toLowerCase();

    try {
        const headers = { Authorization: `Bearer ${TORBOX_API_KEY}` };

        // Cache Check
        const cacheRes = await axios.get(
            'https://api.torbox.app/v1/api/torrents/checkcached',
            { params: { hash: infoHash, format: 'list' }, headers }
        );

        let isCached = false;
        const cData  = cacheRes.data?.data;
        if (cData === true) {
            isCached = true;
        } else if (Array.isArray(cData)) {
            isCached = cData.some(item =>
                (typeof item === 'string' ? item : item?.hash)?.toLowerCase() === infoHash
            );
        } else if (typeof cData === 'object' && cData !== null) {
            isCached = !!cData[Object.keys(cData).find(k => k.toLowerCase() === infoHash)];
        }

        if (!isCached) {
            axios.post(
                'https://api.torbox.app/v1/api/torrents/createtorrent',
                new URLSearchParams({ magnet }).toString(),
                {
                    headers:        { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
                    validateStatus: () => true   
                }
            ).catch(err => console.error("Queue request failed:", err.message));

            return {
                streams: [{
                    name:  'Torbox\n[CACHING]',
                    title: `Not cached yet — Torbox is now downloading it.\nCheck back in a few minutes.\n${arc.name} ${epPad}`,
                    url:   'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
                }]
            };
        }

        const createRes = await axios.post(
            'https://api.torbox.app/v1/api/torrents/createtorrent',
            new URLSearchParams({ magnet }).toString(),
            {
                headers:        { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
                validateStatus: () => true
            }
        );

        const torrentId = createRes.data?.data?.torrent_id || createRes.data?.data?.id;

        if (!torrentId) {
            console.error("No torrent_id in createtorrent response:", JSON.stringify(createRes.data));
            return { streams: [] };
        }

        // Fetch file list
        const mylistRes = await axios.get(
            'https://api.torbox.app/v1/api/torrents/mylist',
            { params: { id: torrentId }, headers }
        );

        const rawData    = mylistRes.data?.data;
        const torrentObj = Array.isArray(rawData) ? rawData[0] : rawData;
        const files      = torrentObj?.files || [];

        let fileId = null;

        if (files.length > 0) {
            const videoFiles = files.filter(f => /\.(mkv|mp4|avi|webm)$/i.test(f.name));

            if (videoFiles.length === 1) {
                fileId = videoFiles[0].id;
            } else if (videoFiles.length > 1) {
                if (isBatch) {
                    if (arc.name === 'Dressrosa') {
                        videoFiles.sort((a, b) => a.name.localeCompare(b.name));
                        const targetIndex = episode - 1;
                        if (targetIndex >= 0 && targetIndex < videoFiles.length) {
                            fileId = videoFiles[targetIndex].id;
                        }
                    } else {
                        const regEp = new RegExp(`(?<!\\d)0*${episode}(?!\\d)`);
                        fileId = videoFiles.find(f => regEp.test(f.name))?.id || videoFiles[0].id;
                    }
                } else {
                    videoFiles.sort((a, b) => b.size - a.size);
                    fileId = videoFiles[0].id;
                }
            }
        }

        const dlParams = { token: TORBOX_API_KEY, torrent_id: torrentId };
        if (fileId !== null) dlParams.file_id = fileId;

        const dlRes = await axios.get(
            'https://api.torbox.app/v1/api/torrents/requestdl',
            { params: dlParams, headers }
        );

        if (dlRes.data?.success && dlRes.data?.data) {
            return {
                streams: [{
                    name:  'Torbox\n[READY]',
                    title: `${torrentTitle}\n⚡ Stream Ready`,
                    url:   dlRes.data.data
                }]
            };
        }

        console.error("requestdl did not return a URL:", JSON.stringify(dlRes.data));
        return { streams: [] };

    } catch (error) {
        console.error("Torbox Pipeline Failure:", error.response?.data ?? error.message);
        return { streams: [] };
    }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log('One Pace Torbox Addon v3.7.0 active on port', process.env.PORT || 7000);
