#!/bin/bash
echo "This assumes that you are doing a green-field install.  If you're not, please exit in the next 15 seconds."
sleep 15
echo "Continuing install, this will prompt you for your password if you're not already running as root and you didn't enable passwordless sudo.  Please do not run me as root!"
if [[ `whoami` == "root" ]]; then
    echo "You ran me as root! Do not run me as root!"
    exit 1
fi
CURUSER=$(whoami)
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get -y upgrade
sudo DEBIAN_FRONTEND=noninteractive apt-get -y install git python-virtualenv python3-virtualenv curl ntp build-essential screen cmake pkg-config libboost-all-dev libevent-dev libunbound-dev libminiupnpc-dev libunwind8-dev liblzma-dev libldns-dev libexpat1-dev libgtest-dev libzmq3-dev
cd ~
git clone https://github.com/Snipa22/xmr-node-proxy
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.0/install.sh | bash
source ~/.nvm/nvm.sh
nvm install v6.9.2
cd ~/xmr-node-proxy
npm install
npm install -g pm2
cp config_example.json config.json
openssl req -subj "/C=IT/ST=Pool/L=Daemon/O=Mining Pool/CN=mining.proxy" -newkey rsa:2048 -nodes -keyout cert.key -x509 -out cert.pem -days 36500
cd ~
pm2 status
sudo env PATH=$PATH:`pwd`/.nvm/versions/node/v6.9.2/bin `pwd`/.nvm/versions/node/v6.9.2/lib/node_modules/pm2/bin/pm2 startup systemd -u $CURUSER --hp `pwd`
sudo chown -R $CURUSER. ~/.pm2
echo "Installing pm2-logrotate in the background!"
pm2 install pm2-logrotate &
echo "You're setup with a shiny new proxy!  Now, go configure it and have fun."
