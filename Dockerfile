FROM ubuntu:16.04

RUN apt-get update \
    && apt-get -y upgrade \
    && apt-get install -y git python-virtualenv python3-virtualenv curl ntp build-essential screen cmake pkg-config libboost-all-dev libevent-dev libunbound-dev libminiupnpc-dev libunwind8-dev liblzma-dev libldns-dev libexpat1-dev libgtest-dev libzmq3-dev

RUN curl -fsSL https://deb.nodesource.com/setup_6.x -o /tmp/node_setup.sh \
    && bash /tmp/node_setup.sh \
    && rm /tmp/node_setup.sh \
    && apt-get install -y nodejs

COPY . /app/

RUN cd /app/ \
    && npm install \
    && cp -n config_example.json config.json \
    && openssl req -subj "/C=IT/ST=Pool/L=Daemon/O=Mining Pool/CN=mining.proxy" -newkey rsa:2048 -nodes -keyout cert.key -x509 -out cert.pem -days 36500

EXPOSE 8080 8443 3333

WORKDIR /app/
CMD ["node", "proxy.js"]
