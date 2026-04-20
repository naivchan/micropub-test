const axios = require('axios');
const Busboy = require('busboy');
// This keeps breaking the Netlify build, so remove this. 
// const { micropub } = require('../config');

const parseMultipart = (event) => {
    return new Promise((resolve, reject) => {
        const fields = {};
        const files = [];
        const busboy = Busboy({ headers: event.headers });
        busboy.on('file', (fieldname, file, info) => {
            const { filename, mimeType } = info;
            let fileBuffer = Buffer.alloc(0);
            file.on('data', (data) => { fileBuffer = Buffer.concat([fileBuffer, data]); });
            file.on('end', () => { files.push({ filename, mimeType, content: fileBuffer }); });
        });
        busboy.on('field', (name, val) => {
            if (fields[name]) {
                if (!Array.isArray(fields[name])) fields[name] = [fields[name]];
                fields[name].push(val);
            } else { fields[name] = val; }
        });
        busboy.on('finish', () => resolve({ fields, files }));
        busboy.on('error', (err) => reject(err));
        const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
        busboy.end(body);
    });
};

exports.handler = async (event) => {
        // 1. The "Handshake" - Add this part!
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            },
            body: "CORS Handshake OK",
        };
    }

    // 2. Your existing code starts here
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    const authHeader = event.headers.authorization;
    if (!authHeader) return { statusCode: 401, body: 'Missing Token' };

    try {
        let content = "";
        let isArticle = false;
        let rawCategories = [];
        let photoFile;
        const contentType = event.headers['content-type'] || '';

        // --- 1. DATA EXTRACTION ---
        if (contentType.includes('application/json')) {
            const body = JSON.parse(event.body);
            const props = body.properties || body;
            content = (props.content && props.content[0] && props.content[0].html) ? props.content[0].html : (props.content ? (props.content[0] || "") : "");
            rawCategories = props.category || props.tag || [];
        } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
            let fields;
            if (contentType.includes('multipart')) {
                const parsed = await parseMultipart(event);
                fields = parsed.fields;
                photoFile = parsed.files[0];
            } else {
                const params = new URLSearchParams(event.body);
                fields = {};
                for (const [key, value] of params.entries()) {
                    fields[key] = params.getAll(key).length > 1 ? params.getAll(key) : value;
                }
            }
            content = fields.content || "";
            rawCategories = fields.category || fields['category[]'] || fields.tags || fields.tag || [];
        }

        // --- 2. IMAGE UPLOAD ---
        let imageHtml = "";
        if (photoFile) {
            const fileName = `${Date.now()}-${photoFile.filename}`;
            const ghPath = `src/assets/images/uploads/${fileName}`;
            const publicPath = `/assets/images/uploads/${fileName}`;

            await axios.put(`https://api.github.com/repos/${process.env.GH_USER}/${process.env.GH_REPO}/contents/${ghPath}`, {
                message: `Upload image via Micropub`,
                content: photoFile.content.toString('base64')
            }, { headers: { Authorization: `token ${process.env.GH_TOKEN}` } });

            imageHtml = `\n        <p><img src="${publicPath}" alt="Upload" style="max-width:100%; height:auto; border-radius:8px;"></p>`;
        }

        // --- 3. CATEGORY NORMALIZATION ---
        let categoryList = Array.isArray(rawCategories) ? rawCategories : [rawCategories];
        const categories = categoryList.flat().filter(cat => cat && typeof cat === 'string').map(cat => cat.replace('#', '').trim().toLowerCase());

        // --- 4. TIME (PST) ---
        const dateObj = new Date();
        const dateStr = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Los_Angeles' });
        const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' });

        // --- 5. FETCH SRC/INDEX.MD & GENERATE ID ---
        const indexUrl = `https://api.github.com/repos/${process.env.GH_USER}/${process.env.GH_REPO}/contents/src/index.md`;
        const getFile = await axios.get(indexUrl, { headers: { Authorization: `token ${process.env.GH_TOKEN}` } });
        const fileContent = Buffer.from(getFile.data.content, 'base64').toString('utf-8');

        const idMatch = fileContent.match(/id="(\d{4})"/);
        const nextNum = (idMatch ? parseInt(idMatch[1]) + 1 : 1).toString().padStart(4, '0');

        // --- 6. FINAL HTML ASSEMBLY ---
        const articleClasses = ["post h-entry", ...categories].join(" ");
        const tagLinks = categories.map(tag => `<a href="#" class="inline-tag" data-tag="${tag}">#${tag}</a>`).join("\n            ");

        const newPost = `
    <article class="${articleClasses}" id="${nextNum}">
        <div class="post-header"><span class="p-author">@arimamary</span> <time class="dt-published">📅${dateStr} 🕐${timeStr}</time> <a href="#${nextNum}" class="u-uid">#${nextNum}</a></div>
        <div class="e-content">
            ${content.trim().replace(/\n/g, '<br>')}
            ${imageHtml}
        </div>
        <section class="tags p-category">
            ${tagLinks}
        </section>
    </article>`;

        // --- 7. PUSH TO GITHUB ---
        const marker = '<div id="micropub-marker" style="display:none;">--- MICROPUB-TARGET ---</div>';
        if (!fileContent.includes(marker)) return { statusCode: 500, body: "Marker missing in src/index.md" };

        await axios.put(indexUrl, {
            message: `Post #${nextNum} [micropub]`,
            content: Buffer.from(fileContent.replace(marker, `${marker}\n${newPost}`)).toString('base64'),
            sha: getFile.data.sha
        }, { headers: { Authorization: `token ${process.env.GH_TOKEN}` } });

        // --- 8. TRIGGER RSS ACTION ---
        try {
            await axios.post(`https://api.github.com/repos/${process.env.GH_USER}/${process.env.GH_REPO}/actions/workflows/rss-generator.yml/dispatches`, 
            { ref: 'main' }, 
            { headers: { Authorization: `token ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Netlify-Function' }});
        } catch (e) { console.error("RSS fail:", e.message); }

        return { 
            statusCode: 201, 
            headers: { "Location": `https://micro.arimamary.net/#${nextNum}` },
            body: JSON.stringify({ message: 'Success' }) 
        };

    } catch (error) {
        return { statusCode: 500, body: error.message };
    }
};
