#!/bin/bash

# Bash Color Library
#
# Source:  https://gist.github.com/tavinus/925c7c9e67b5ba20ae38637fd0e06b07
ESeq="\x1b["
RCol="$ESeq"'0m'    # Text Reset

# Regular               Bold                    Underline               High Intensity          BoldHigh Intens         Background              High Intensity Backgrounds
Bla="$ESeq"'0;30m';     BBla="$ESeq"'1;30m';    UBla="$ESeq"'4;30m';    IBla="$ESeq"'0;90m';    BIBla="$ESeq"'1;90m';   On_Bla="$ESeq"'40m';    On_IBla="$ESeq"'0;100m';
Red="$ESeq"'0;31m';     BRed="$ESeq"'1;31m';    URed="$ESeq"'4;31m';    IRed="$ESeq"'0;91m';    BIRed="$ESeq"'1;91m';   On_Red="$ESeq"'41m';    On_IRed="$ESeq"'0;101m';
Gre="$ESeq"'0;32m';     BGre="$ESeq"'1;32m';    UGre="$ESeq"'4;32m';    IGre="$ESeq"'0;92m';    BIGre="$ESeq"'1;92m';   On_Gre="$ESeq"'42m';    On_IGre="$ESeq"'0;102m';
Yel="$ESeq"'0;33m';     BYel="$ESeq"'1;33m';    UYel="$ESeq"'4;33m';    IYel="$ESeq"'0;93m';    BIYel="$ESeq"'1;93m';   On_Yel="$ESeq"'43m';    On_IYel="$ESeq"'0;103m';
Blu="$ESeq"'0;34m';     BBlu="$ESeq"'1;34m';    UBlu="$ESeq"'4;34m';    IBlu="$ESeq"'0;94m';    BIBlu="$ESeq"'1;94m';   On_Blu="$ESeq"'44m';    On_IBlu="$ESeq"'0;104m';
Pur="$ESeq"'0;35m';     BPur="$ESeq"'1;35m';    UPur="$ESeq"'4;35m';    IPur="$ESeq"'0;95m';    BIPur="$ESeq"'1;95m';   On_Pur="$ESeq"'45m';    On_IPur="$ESeq"'0;105m';
Cya="$ESeq"'0;36m';     BCya="$ESeq"'1;36m';    UCya="$ESeq"'4;36m';    ICya="$ESeq"'0;96m';    BICya="$ESeq"'1;96m';   On_Cya="$ESeq"'46m';    On_ICya="$ESeq"'0;106m';
Whi="$ESeq"'0;37m';     BWhi="$ESeq"'1;37m';    UWhi="$ESeq"'4;37m';    IWhi="$ESeq"'0;97m';    BIWhi="$ESeq"'1;97m';   On_Whi="$ESeq"'47m';    On_IWhi="$ESeq"'0;107m';

CURUSER=$(whoami)
if [[ `whoami` == "root" ]]; then
    echo -e "${URed}ERROR:${RCol}${BRed} This script should not be run as root!  Exiting NOW."
    exit 1
fi

MY_NODE_VERSION="6.9.2"
MY_NVM_VERSION="0.37.2"

echo -e "${UYel}ALERT:${$RCol}${Yel} This unattended xmr-node-proxy installer is about to modify your system!\nIt will reset ANY user configurations you want in:\n\n    - node.js\n    - node version manager\n    - pm2 app manager\n\n${RCol}${BCya}Press CTRL+C if you wish to exit this script within the next 15 seconds.\nWait if you don't care.\n${RCol}"

# Detect and remove managed directories
declare -a m=("$HOME/.npm" "$HOME/.pm2" "$HOME/.nvm" "$HOME/.node-gyp" "$HOME/xmr-node-proxy" "$HOME/.cache" )
for i in "${m[@]}"
do
        if [ -d $i ]; then
                echo -e "${UPur}WARNING:${RCol}${BPur} $i directory is found, this script will remove it NOW.${RCol}"
                rm -rf "$i"
        fi
done

# Install packages (new wrapper with sanity checking)
echo -e "\n${UGre}INFO:${RCol}${BGre} Installing system dependencies:${RCol}\n"
declare -a m=("git" "python-is-python2" "python3" "virtualenv" "python3-virtualenv" "curl" "ntp" "build-essential" "screen" "cmake" "pkg-config" "libboost-all-dev" "libevent-dev" "libunbound-dev" "libminiupnpc-dev" "libunwind-dev" "liblzma-dev" "libldns-dev" "libexpat1-dev" "libgtest-dev" "libzmq3-dev")
for i in "${m[@]}"
do
	echo -ne "${BGre}  - Installing ${RCol}${BYel}$i${RCol}${BGre}...${RCol}"
	if ! sudo dpkg -s $i >/dev/null 2>&1; then
		{ error=$(sudo DEBIAN_FRONTEND=noninteractive apt-get -y install $i ); } {out}>&1
		if echo $error | grep -i "$i is already" >/dev/null 2>&1; then
			echo -e "${BPur}skipped${RCol}"
		else
			if echo $error | grep -i "failed" >/dev/null 2>&1; then
				echo -e "${BRed}failed\n\nPackage $i failed to install.  Please fix this!  The script will now exit.\n${RCol}"
			else
				echo -e "${BCya}installed${RCol}"
			fi
		fi
	else
		echo -e "${BPur}skipped${RCol}"
	fi
done

cd $HOME
echo -n -e "\n${UGre}INFO:${RCol}${BGre}  Cloning GitHub Repository...\n\n${RCol}"
git clone https://github.com/Snipa22/xmr-node-proxy
echo -n -e "\n${UGre}INFO:${RCol}${BGre}  Downloading Node Version Manager...\n\n${RCol}"
curl -o- https://raw.githubusercontent.com/creationix/nvm/v${MY_NVM_VERSION}/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
echo -n -e "\n${UGre}INFO:${RCol}${BGre}  Installing Node ${RCol}${UYel}${MY_NODE_VERSION}${RCol}${BGre} with NVM...\n\n${RCol}"
nvm install v$MY_NODE_VERSION
echo -n -e "\n${UGre}INFO:${RCol}${BGre}  Compiling project...\n\n${RCol}"
cd $HOME/xmr-node-proxy
npm install
npm install -g pm2@3.5.1
echo -n -e "\n${UGre}INFO:${RCol}${BGre}  Generating project signing key...\n\n${RCol}"
cp config_example.json config.json
openssl req -subj "/C=IT/ST=Pool/L=Daemon/O=Mining Pool/CN=mining.proxy" -newkey rsa:2048 -nodes -keyout cert.key -x509 -out cert.pem -days 36500
cd $HOME
echo -n -e "\n${UGre}INFO:${RCol}${BGre}  Configuring pm2...\n\n${RCol}"
pm2 status
sudo env PATH=$PATH:`pwd`/.nvm/versions/node/v${MY_NODE_VERSION}/bin `pwd`/.nvm/versions/node/v${MY_NODE_VERSION}/lib/node_modules/pm2/bin/pm2 startup systemd -u $CURUSER --hp `pwd`
sudo chown -R $CURUSER:$CURUSER $HOME/.pm2
echo -n -e "\n${UGre}INFO:${RCol}${BGre}  Installing ${RCol}${BYel}pm2-logrotate${RCol}${BGre}...\n\n${RCol}"
pm2 install pm2-logrotate
echo -e "\n${UGre}INFO:${RCol}${BGre}  xmnr-node-proxy installation is ${RCol}${UCya}complete${RCol}${BGre}.  Have fun with your new installation!${RCol}\n\n"
