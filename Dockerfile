FROM ubuntu:16.04
LABEL maintainer="JZG Dev<https://github.com/jzgdev>"
LABEL Name="Dockerized xmr-node-proxy"
LABEL Version="1.4"
RUN export BUILD_DEPS="cmake \
                       pkg-config \
                       git \
                       build-essential \
                       curl \
                       sudo"\
    && apt-get update && apt-get upgrade -qqy \
    && apt-get install ${BUILD_DEPS} -qqy \
    && curl -o- https://deb.nodesource.com/setup_6.x| bash \
    && apt-get install --no-install-recommends -qqy \
        python-virtualenv \
        python3-virtualenv ntp screen \
        libboost-all-dev libevent-dev nodejs \
        libunbound-dev libminiupnpc-dev \
        libunwind8-dev liblzma-dev libldns-dev \
        libexpat1-dev libgtest-dev libzmq3-dev \
    && echo "proxy ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers
RUN mkdir /app \
    && mkdir -p /home/proxy \
    && chown -R proxy:proxy /home/proxy \
    && chown -R proxy:proxy /app
USER proxy
ENV HOME=/home/proxy/
WORKDIR $HOME
RUN sudo chown -R proxy.proxy $(npm config get prefix)/lib/node_modules \
    && sudo npm config set prefix '/home/proxy/.npm-global'
ENV PATH=/home/proxy/.npm-global/bin:${PATH}
RUN git clone https://github.com/Snipa22/xmr-node-proxy /app \
    && npm install -g pm2 \
    && cd /app && npm install
CMD ["pm2-runtime", "status"]
RUN cd /app \
    &&  openssl req -subj "/C=IT/ST=Pool/L=Daemon/O=Mining Pool/CN=mining.proxy" -newkey rsa:2048 -nodes -keyout cert.key -x509 -out cert.pem -days 36500 
USER root
RUN apt-get --auto-remove purge -qqy ${BUILD_DEPS} \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /app/logs
USER proxy
WORKDIR /app
CMD ["pm2-runtime", "install", "pm2-logrotate"]
CMD ["pm2-runtime", "proxy.js"]