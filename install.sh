#!/bin/bash
platform='unknown'; unamestr=`uname`;
if [[ "$unamestr" == 'Linux' ]]; then
	platform='linux'
	echo "This assumes that you are doing a green-field install for $unamestr.  If you're not, please exit in the next 5 seconds with '^C'."
	sleep 5
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

elif [[ "$unamestr" == 'FreeBSD' ]]; then
	
	#!/usr/local/bin/bash	
	platform='freebsd'
	echo "This assumes that you are doing a green-field install for $unamestr.  If you're not, please exit in the next 5 seconds with '^C'."
	sleep 5
	echo "Continuing install, this will prompt you for your password if you're not already running as root and you didn't enable passwordless sudo.  Please do not run me as root!"
	if [[ `whoami` == "root" ]]; then
	    echo "You ran me as root! Do not run me as root!"
	    exit 1
	fi
	CURUSER=$(whoami)
	sudo pkg update && pkg upgrade -y 
	sudo pkg install -y git \
		py27-virtualenv py36-virtualenv \
		curl ntp screen \
		cmake boost-libs libevent \
		unbound miniupnpc libunwind \
		lzmalib ldns-1.7.0_1 expat \
		googletest libzmq3 glib \
		gmake-4.2.1_2 clang35-3.5.2_4 \
		gcc node6-6.14.1_1 npm-node6-5.7.1
	cd ~
	git clone https://github.com/Snipa22/xmr-node-proxy
	cd ~/xmr-node-proxy
	echo 'export CC="gcc"' >> ~/.bashrc
	echo 'export CXX="g++"' >> ~/.bashrc
	echo 'export CXXFLAGS="-g"' >> ~/.bashrc
	sudo chown -R $CURUSER /usr/local/lib/node_modules/
	sudo chown $CURUSER /usr/local/bin
	sudo chown $CURUSER /usr/local/share
	/usr/local/bin/npm install
	/usr/local/bin/npm install -g pm2
	cp config_example.json config.json;
	sudo openssl req -subj "/C=IT/ST=Pool/L=Daemon/O=Mining Pool/CN=mining.proxy" -days 36500 -newkey rsa:2048 -nodes -keyout cert.key -x509 -out cert.pem;
	cd ~
	/usr/local/bin/pm2 status
	sudo env PATH=$PATH:/usr/local/bin /usr/local/lib/node_modules/pm2/bin/pm2 startup rcd -u nodeproxy --hp /home/nodeproxy
	sudo chown -R $CURUSER ~/.pm2
	echo "Installing pm2-logrotate in the background!"
	/usr/local/bin/pm2 install pm2-logrotate &
	echo "You're setup with a shiny new proxy!  Now, go configure it and have fun."
elif [[ "$unamestr" == 'Darwin' ]]; then
	platform='darwin'
	echo "This assumes that you are doing a green-field install for $unamestr.  If you're not, please exit in the next 5 seconds with '^C'."
	sleep 5
	echo "Continuing install, this will prompt you for your password if you're not already running as root and you didn't enable passwordless sudo.  Please do not run me as root!"
		if [[ `whoami` == "root" ]]; then
		    echo "You ran me as root! Do not run me as root!"
		    exit 1
		fi
	CURUSER=$(whoami)
	if [ ! -d "/Users/${CURUSER}/Library/Caches/Homebrew" ]; 
		then /usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)" ; 
	else 
		BREW=$(brew update) 
		if [ "$BREW" != "Already up-to-date." ]
			then /usr/local/bin/brew upgrade 
				 echo "brew has succesfully updated and upgraded remote homebrew packages." 
		else echo "$BREW" 
		fi
	fi
	brew install git pyenv curl ntp gcc cmake screen cmake pkg-config boost boost-python boost-python3 libevent unbound miniupnpc libunwind-headers xz ldns expat zmq
	cd ~/Desktop
	git clone https://github.com/Snipa22/xmr-node-proxy
	cd ~/Desktop/xmr-node-proxy
	if [ -d "/Users/${CURUSER}/n/" ]; then n 6.9.2 ; 
	elif [ -d "/Users/${CURUSER}/n/" ]; then nvm install v6.9.2; 
	else curl -L https://git.io/n-install | bash && n 6.9.2; 
	fi
	npm install -g Unitech/pm2#development && pm2 update
	npm install
	cp config_example.json config.json
	openssl req -subj "/C=IT/ST=Pool/L=Daemon/O=Mining Pool/CN=mining.proxy" -newkey rsa:2048 -nodes -keyout cert.key -x509 -out cert.pem -days 36500
	cd ~
	PM2_VARS=$(pm2 startup)
	START_PM2=$(echo "$PM2_VARS" | sed -n -e '/env/,$p')
	sudo chown -R $CURUSER ~/.pm2
	sudo $START_PM2
	echo "Installing pm2-logrotate in the background!"
	pm2 install pm2-logrotate 
	echo "You're setup with a shiny new proxy!  Now, go configure it and have fun."
fi

