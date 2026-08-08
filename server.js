const net = require('net');
const { readTlsClientHello, getExtensionData  } = require('read-tls-client-hello');

const proxyServer = net.createServer( async (clientSocket) => {
    try {
      const parsedData = await readTlsClientHello(clientSocket);
      const sniData = getExtensionData(clientHello, 'sni');
      const serversName = sniData ? sniData.serverName : null;

      const backendSocket = net.connect(443, serversName, () => {
        autoPiping(clientSocket, backendSocket);
      });
      backendSocket.on('error', (err) => {
        console.error(err);
        clientSocket.destroy();
      });
    } catch (error) {
      console.error(error.message);
      clientSocket.destroy();
    }
      
  });
});

function autoPiping(client, backend) {


  client.pipe(backend);
  backend.pipe(client);

  client.on('error', (err) => {
    console.error(err);
    client.destroy();
  });
  backend.on('error', (err) => {
    console.error(err);
    backend.destroy();
  });
}

proxyServer.listen(3000, () => {
  console.log('Started');
});
