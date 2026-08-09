const http = require('http');
const express = require('express');
const { Readable, Transform } = require('stream');
const { StringDecoder } = require('string_decoder');
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.raw({ type: '*/*', limit: '50mb' }));

app.get('/', (req, res) => {
    res.send('Hello, World!');
});

app.all('/proxy', async (req, res) => {
    const encodedUrl = req.query.url || req.query.uri;
    const targetUrl = encodedUrl ? Buffer.from(encodedUrl, 'base64').toString('utf-8') : null;
    if (!targetUrl) {
        return res.status(400).send('Missing target URL in ?url= (base64 encoded)');
    }
    console.log(`Proxying request to: ${targetUrl}`);

    const forwardedHeaders = { ...req.headers };
    delete forwardedHeaders.host;
    delete forwardedHeaders['content-length'];
    delete forwardedHeaders['accept-encoding'];

    const fetchRes = await fetch(targetUrl, {
        method: req.method,
        headers: forwardedHeaders,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
        redirect: 'manual',
    });

    const rewriteProxyUrl = (url) => {
        try {
            const resolved = new URL(url, targetUrl).toString();
            return '/proxy?url=' + Buffer.from(resolved, 'utf8').toString('base64');
        } catch {
            return url;
        }
    };

    const rewriteSetCookie = (cookie) => cookie.replace(/;\s*Domain=[^;]+/i, '');

    const rewriteCsp = (policy) => {
        return policy.split(/\s+/).map((token) => {
            if (!token || token.startsWith("'") || /^data:|^blob:|^filesystem:|^mediastream:|^ws:|^wss:/i.test(token)) {
                return token;
            }
            if (/^(?:https?:|\/)/i.test(token) || token.includes('.')) {
                return rewriteProxyUrl(token);
            }
            return token;
        }).join(' ');
    };

    res.status(fetchRes.status);
    fetchRes.headers.forEach((value, name) => {
        const headerName = name.toLowerCase();
        if (['transfer-encoding', 'content-encoding', 'connection', 'content-length'].includes(headerName)) {
            return;
        }
        if (headerName === 'set-cookie') {
            const cookies = Array.isArray(value) ? value : [value];
            cookies.forEach((cookie) => res.append('Set-Cookie', rewriteSetCookie(cookie)));
            return;
        }
        if (headerName === 'location') {
            res.setHeader('Location', rewriteProxyUrl(value));
            return;
        }
        if (headerName === 'content-security-policy' || headerName === 'content-security-policy-report-only') {
            res.setHeader(name, rewriteCsp(value));
            return;
        }
        res.setHeader(name, value);
    });

    let bodyStream = fetchRes.body;
    if (!bodyStream) {
        return res.end();
    }

    if (typeof bodyStream.pipe !== 'function') {
        bodyStream = Readable.from(bodyStream);
    }

    bodyStream.on('error', (err) => {
        console.error('Error while streaming upstream response:', err);
        if (!res.headersSent) {
            res.status(502).send('Bad Gateway');
        } else {
            res.destroy(err);
        }
    });

    const urlAttrRegex = /\b(?:href|src|action|formaction|poster)=(["'])([^"']*)\1/gi;
    const srcsetRegex = /\bsrcset=(["'])([^"']*)\1/gi;
    const metaRefreshRegex = /\bcontent=(["'])([^"']*url=)([^"']*)\1/gi;
    const decoder = new StringDecoder('utf8');
    let tail = '';
    const maxTail = Math.max(4096, (targetUrl.length + 64) * 2);

    const rewriteUrl = (value) => {
        const trimmed = value.trim();
        if (!trimmed || /^(?:javascript:|mailto:|tel:|data:|#)/i.test(trimmed)) {
            return value;
        }
        try {
            const resolved = new URL(trimmed, targetUrl).toString();
            return '/proxy?url=' + Buffer.from(resolved, 'utf8').toString('base64');
        } catch {
            return value;
        }
    };

    const rewriteSrcset = (value) => {
        return value.split(',').map((part) => {
            const trimmed = part.trim();
            const spaceIndex = trimmed.search(/\s+/);
            if (spaceIndex === -1) {
                return rewriteUrl(trimmed);
            }
            const urlPart = trimmed.slice(0, spaceIndex);
            const descriptor = trimmed.slice(spaceIndex);
            return rewriteUrl(urlPart) + descriptor;
        }).join(', ');
    };

    const transformer = new Transform({
        transform(chunk, encoding, callback) {
            const text = decoder.write(chunk);
            const combined = tail + text;
            const keep = combined.slice(-maxTail);
            const process = combined.slice(0, combined.length - keep.length);

            let modified = process.replace(urlAttrRegex, (match, quote, attrValue) => {
                return match.slice(0, match.indexOf(quote) + 1) + rewriteUrl(attrValue) + quote;
            });

            modified = modified.replace(srcsetRegex, (match, quote, attrValue) => {
                return match.slice(0, match.indexOf(quote) + 1) + rewriteSrcset(attrValue) + quote;
            });

            modified = modified.replace(metaRefreshRegex, (match, quote, prefix, urlValue) => {
                return match.slice(0, match.indexOf(quote) + 1) + prefix + rewriteUrl(urlValue) + quote;
            });

            tail = keep;
            callback(null, Buffer.from(modified, 'utf8'));
        },
        flush(callback) {
            const text = decoder.end();
            const combined = tail + text;
            let modified = combined.replace(urlAttrRegex, (match, quote, attrValue) => {
                return match.slice(0, match.indexOf(quote) + 1) + rewriteUrl(attrValue) + quote;
            });

            modified = modified.replace(srcsetRegex, (match, quote, attrValue) => {
                return match.slice(0, match.indexOf(quote) + 1) + rewriteSrcset(attrValue) + quote;
            });

            modified = modified.replace(metaRefreshRegex, (match, quote, prefix, urlValue) => {
                return match.slice(0, match.indexOf(quote) + 1) + prefix + rewriteUrl(urlValue) + quote;
            });

            callback(null, Buffer.from(modified, 'utf8'));
        }
    });

    bodyStream.pipe(transformer).pipe(res);
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
