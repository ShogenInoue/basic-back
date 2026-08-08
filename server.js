const net = require('net');
const { parseTLSClientHello } = require('read-tls-client-hello');

const proxyServer = net.createServer((clientSocket) => {
  clientSocket.once('data', (initalData) => {
    try {
      const parsedData = parseTLSClientHello(initalData);
      const serversName = parsedData.serverName;

      const backendSocket = net.connect(443, serversName, () => {
        autoPiping(clientSocket, backendSocket, initalData);
        });
      backendSocket.on('error', (err) => {
        console.error((err));
        clientSocket.destory();
      });
    } catch (error) {
      console.error(error.message);
      clientSocket.destory();
    };
      
  });
});

function autoPiping(client, backend, hello) {
  backend.write(hello);

  client.pipe(backend);
  backend.pipe(client);

  client.on('error', (err) => {
    console.error(err);
    client.destory();
  });
  backend.on('error', (err) => {
    console.error(err);
    backend.destory();
  });
}

proxyServer.listen(433, () => {
  console.log('Started');
});
