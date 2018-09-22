#!/bin/bash
echo "This assumes that you are doing a green-field install.  If you're not, please exit in the next 15 seconds."
sleep 15
echo "Continuing install, this will prompt you for your password if you're not already running as root and you didn't enable passwordless sudo.  Please do not run me as root!"
if [[ `whoami` == "root" ]]; then
    echo "You ran me as root! Do not run me as root!"
    exit 1
fi
CURUSER=$(whoami)

if which yum >/dev/null; then
  sudo yum -y update
  sudo yum -y upgrade
  sudo yum -y install git curl make gcc-c++ python-virtualenv boost-devel boost-system-devel boost-date-time-devel
else
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get -y upgrade
  sudo DEBIAN_FRONTEND=noninteractive apt-get -y install git curl make g++ python-virtualenv libboost-dev libboost-system-dev libboost-date-time-dev
fi
cd ~
git clone https://github.com/MoneroOcean/xmr-node-proxy
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.0/install.sh | bash
source ~/.nvm/nvm.sh
nvm install v8.11.3
nvm alias default v8.11.3
cd ~/xmr-node-proxy
npm install || exit 1
npm install -g pm2
cp config_example.json config.json
openssl req -subj "/C=IT/ST=Pool/L=Daemon/O=Mining Pool/CN=mining.proxy" -newkey rsa:2048 -nodes -keyout cert.key -x509 -out cert.pem -days 36500
cd ~
pm2 status
sudo env PATH=$PATH:`pwd`/.nvm/versions/node/v8.11.3/bin `pwd`/.nvm/versions/node/v8.11.3/lib/node_modules/pm2/bin/pm2 startup systemd -u $CURUSER --hp `pwd`
sudo chown -R $CURUSER. ~/.pm2
echo "Installing pm2-logrotate in the background!"
pm2 install pm2-logrotate
echo "You're setup with a shiny new proxy! Now, do 'source ~/.bashrc' command, go configure it and have fun."
