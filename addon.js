const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

// We now define the max number of episodes per arc so Stremio can build the UI
const ARCS = [
    { name: "Romance Dawn", eps: 4 },
    { name: "Orange Town", eps: 3 },
    { name: "Syrup Village", eps: 5 },
    { name: "Gaimon", eps: 1 },
    { name: "Baratie", eps: 7 },
    { name: "Arlong Park", eps: 8 },
    { name: "The Adventures of Buggy's Crew", eps: 1 },
    { name: "Loguetown", eps: 3 },
    { name: "Reverse Mountain", eps: 1 },
    { name: "Whiskey Peak", eps: 2 },
    { name: "The Trials of Koby-Meppo", eps: 1 },
    { name: "Little Garden", eps: 4 },
    { name: "Drum Island", eps: 5 },
    { name: "Arabasta", eps: 14 },
    { name: "Jaya", eps: 5 },
    { name: "Skypiea", eps: 24 },
    { name: "Long Ring Long Land", eps: 6 },
    { name: "Water Seven", eps: 18 },
    { name: "Enies Lobby", eps: 23 },
    { name: "Post-Enies Lobby", eps: 4 },
    { name: "Thriller Bark", eps: 22 },
    { name: "Sabaody Archipelago", eps: 11 },
    { name: "Amazon Lily", eps: 5 },
    { name: "Impel Down", eps: 14 },
    { name: "If You Could Go Anywhere... The Adventures of the Straw Hats", eps: 1 },
    { name: "Marineford", eps: 14 },
    { name: "Post-War", eps: 9 },
    { name: "Return to Sabaody", eps: 3 },
    { name: "Fishman Island", eps: 24 },
    { name: "Punk Hazard", eps: 22 },
    { name: "Dressrosa", eps: 48 },
    { name: "Zou", eps: 11 },
    { name: "Whole Cake Island", eps: 39 },
    { name: "Reverie", eps: 3 },
    { name: "Wano", eps: 45 },
    { name: "Egghead", eps: 30 } // Padded extra for future ongoing releases
];

const builder = new addonBuilder({
    id: 'org.vibecode.onepace.torbox',
    version: '3.0.0',
    name: 'One Pace - Torbox Elite',
    description: 'Standalone One Pace series mapped chronologically via Torbox.',
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

// RSS Parser
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

        const [resIndiv, resBatch] = await Promise.all([
            axios.get(`${baseUrl}&q=${encodeURIComponent(qIndiv)}`, { headers }),
            axios.get(`${baseUrl}&q=${encodeURIComponent(qBatch)}`, { headers })
        ]);

        const itemsIndiv = parseRSS(resIndiv.data);
        const itemsBatch = parseRSS(resBatch.data);

        let candidates = [];

        for (const item of itemsIndiv) {
            candidates.push({
                title: item.title,
                magnet: item.link,
                pubDate: item.pubDate,
                isBatch: false,
                isExtended: /extended/i.test(item.title)
            });
        }

        const escapedArc = arcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

        const extendedPool = candidates.filter(c => c.isExtended);
        if (extendedPool.length > 0) {
            candidates = extendedPool;
        }

        const batches = candidates.filter(c => c.isBatch).sort((a, b) => b.pubDate - a.pubDate);
        const individuals = candidates.filter(c => !c.isBatch).sort((a, b) => b.pubDate - a.pubDate);

        if (batches.length > 0 && individuals.length > 0) {
            if (individuals[0].pubDate > batches[0].pubDate) return individuals[0];
            return batches[0];
        } else if (batches.length > 0) {
            return batches
