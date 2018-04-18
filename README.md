# xmr-node-proxy


## Setup Instructions

Based on a clean Ubuntu 16.04 LTS minimal install

## Switching from other xmr-node-proxy repository

```bash
cd xmr-node-proxy
git remote set-url origin https://github.com/MoneroOcean/xmr-node-proxy.git && git pull -X theirs --no-edit && npm update
```

## Deployment via Installer

1. Create a user 'nodeproxy' and assign a password (or add an SSH key. If you prefer that, you should already know how to do it)

```bash
useradd -d /home/nodeproxy -m -s /bin/bash nodeproxy
passwd nodeproxy
```

2. Add your user to `/etc/sudoers`, this must be done so the script can sudo up and do it's job.  We suggest passwordless sudo.  Suggested line: `<USER> ALL=(ALL) NOPASSWD:ALL`.  Our sample builds use: `nodeproxy ALL=(ALL) NOPASSWD:ALL`

```bash
echo "nodeproxy ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers
```

3. Log in as the **NON-ROOT USER** you just created and run the [deploy script](https://raw.githubusercontent.com/MoneroOcean/xmr-node-proxy/master/install.sh).  This is very important!  This script will install the proxy to whatever user it's running under!

```bash
curl -L https://raw.githubusercontent.com/MoneroOcean/xmr-node-proxy/master/install.sh | bash
```

3. Once it's complete, copy `example_config.json` to `config.json` and edit as desired.
4. Run: `source ~/.bashrc`  This will activate NVM and get things working for the following pm2 steps.
8. Once you're happy with the settings, go ahead and start all the proxy daemon, commands follow.

```shell
cd ~/xmr-node-proxy/
pm2 start proxy.js --name=proxy --log-date-format="YYYY-MM-DD HH:mm Z"
pm2 save
```
You can check the status of your proxy by either issuing

```
pm2 logs proxy
```

or using the pm2 monitor

```
pm2 monit
```

## Known Issues

VMs with 512Mb or less RAM will need some swap space in order to compile the C extensions for node.  Bignum and the CN libraries can chew through some serious memory during compile.  In regards to this, one of our users has put together a guide for T2.Micro servers: http://moneroocean.blogspot.com/2017/10/setup-of-xmr-node-proxy-on-free-tier.html

If not running on an Ubuntu 16.04 system, please make sure your kernel is at least 3.2 or higher, as older versions will not work for this.

Many smaller VMs come with ulimits set very low. We suggest looking into setting the ulimit higher. In particular, `nofile` (Number of files open) needs to be raised for high-usage instances.

In your `packages.json`, do a `npm install`, and it should pass.


## Performance

The proxy gains a massive boost over a basic pool by accepting that the majority of the hashes submitted _will_ not be valid (does not exceed the required difficulty of the pool).  Due to this, the proxy doesn't bother with attempting to validate the hash state nor value until the share difficulty exceeds the pool difficulty.

In testing, we've seen AWS t2.micro instances take upwards of 2k connections, while t2.small taking 6k.  The proxy is extremely light weight, and while there are more features on the way, it's our goal to keep the proxy as light weight as possible.

## Configuration Guidelines

Please check the [wiki](https://github.com/MoneroOcean/xmr-node-proxy/wiki/config_review) for information on configuration

Developer Donations
===================
If you'd like to make a one time donation, the addresses are as follows:
* XMR - ```499fS1Phq64hGeqV8p2AfXbf6Ax7gP6FybcMJq6Wbvg8Hw6xms8tCmdYpPsTLSaTNuLEtW4kF2DDiWCFcw4u7wSvFD8wFWE```
* AEON - ```WmsEg3RuUKCcEvFBtXcqRnGYfiqGJLP1FGBYiNMgrcdUjZ8iMcUn2tdcz59T89inWr9Vae4APBNf7Bg2DReFP5jr23SQqaDMT```
* ETN - ```etnkQMp3Hmsay2p7uxokuHRKANrMDNASwQjDUgFb5L2sDM3jqUkYQPKBkooQFHVWBzEaZVzfzrXoETX6RbMEvg4R4csxfRHLo1```
* SUMO - ```Sumoo1DGS7c9LEKZNipsiDEqRzaUB3ws7YHfUiiZpx9SQDhdYGEEbZjRET26ewuYEWAZ8uKrz6vpUZkEVY7mDCZyGnQhkLpxKmy```

## Known Working Pools

* [XMRPool.net](https://xmrpool.net)
* [supportXMR.com](https://supportxmr.com)
* [pool.xmr.pt](https://pool.xmr.pt)
* [minemonero.pro](https://minemonero.pro)
* [XMRPool.xyz](https://xmrpool.xyz)
* [ViaXMR.com](https://viaxmr.com)
* [mine.MoneroPRO.com](https://mine.moneropro.com)
* [MinerCircle.com](https://www.minercircle.com)
* [xmr.p00ls.net](https://www.p00ls.net)
* [MoriaXMR.com](https://moriaxmr.com)
* [MoneroOcean.stream](https://moneroocean.stream)
* [SECUmine.net](https://secumine.net)
* [Chinaenter.cn](http://xmr.chinaenter.cn)
* [XMRPool.eu](https://xmrpool.eu)

If you'd like to have your pool added, please make a pull request here, or contact MoneroOcean at support@moneroocean.stream!
