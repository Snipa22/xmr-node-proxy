FROM ubuntu:16.04
LABEL maintainer="Pedro Lobo <https://github.com/pslobo>"
LABEL Name="Dockerized xmr-node-proxy"
LABEL Version="1.4"

RUN export BUILD_DEPS="cmake \
                       pkg-config \
                       git \
                       build-essential \
                       curl" \

    && apt-get update && apt-get upgrade -qqy  \
    && apt-get install --no-install-recommends -qqy \
        ${BUILD_DEPS} python-virtualenv \
        python3-virtualenv ntp screen \
        libboost-all-dev libevent-dev \
        libunbound-dev libminiupnpc-dev \
        libunwind8-dev liblzma-dev libldns-dev \
        libexpat1-dev libgtest-dev libzmq3-dev \

    && curl -o- https://deb.nodesource.com/setup_6.x| bash \
    && apt-get install nodejs \

    && git clone https://github.com/Snipa22/xmr-node-proxy /app \
    && cd /app && npm install \

    && openssl req -subj "/C=IT/ST=Pool/L=Daemon/O=Mining Pool/CN=mining.proxy" \
        -newkey rsa:2048 -nodes -keyout cert.key -x509 -out cert.pem -days 36500 \

    && apt-get --auto-remove purge -qqy ${BUILD_DEPS} \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && chown -R proxy.proxy /app \
    && mkdir /logs && chown -R proxy.proxy /logs

USER proxy
WORKDIR /app

ENTRYPOINT ["node","proxy.js"]