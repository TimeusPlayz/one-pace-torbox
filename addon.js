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
    version: '4.1.1',
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
