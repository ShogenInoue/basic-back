const http = require('http');
const express = require('express');
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.raw({ type: '*/*', limit: '50mb' }));

app.get('/', (req, res) => {
    res.send('Hello, World!');
});

app.all('/proxy', async (req, res) => {
    const targetUrl = req.query.url || req.query.uri;
    if (!targetUrl) {
        return res.status(400).send('Missing target URL in ?url=');
    }

    const forwardedHeaders = { ...req.headers };
    delete forwardedHeaders.host;

    const fetchRes = await fetch(targetUrl, {
        method: req.method,
        headers: forwardedHeaders,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
    });

    res.status(fetchRes.status);
    fetchRes.headers.forEach((value, name) => {
        res.setHeader(name, value);
    });

    const buffer = await fetchRes.arrayBuffer();
    res.send(Buffer.from(buffer));
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
