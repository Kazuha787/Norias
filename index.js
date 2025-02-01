import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import chalk from 'chalk';
import banner from './utils/banner.js';

class DeviceHeartbeatBot {
    constructor(account, proxy = null) {
        this.account = account;
        this.proxy = proxy;
        this.baseUrls = {
            secApi: 'https://naorisprotocol.network/sec-api/api',
            testnetApi: 'https://naorisprotocol.network/testnet-api/api/testnet'
        };
        this.uptimeMinutes = 0;
    }

    static async loadAccounts(configPath = path.join(process.cwd(), 'accounts.json')) {
        try {
            const configData = await fs.readFile(configPath, 'utf8');
            return JSON.parse(configData);
        } catch (error) {
            console.error(chalk.red('Failed to load accounts:'), error.message);
            process.exit(1);
        }
    }

    static async loadProxies(proxyPath = path.join(process.cwd(), 'proxy.txt')) {
        try {
            const proxyData = await fs.readFile(proxyPath, 'utf8');
            return proxyData.trim().split('\n').map(line => line.trim());
        } catch (error) {
            console.error(chalk.red('Failed to load proxies:'), error.message);
            return [];
        }
    }

    getAxiosConfig() {
        const config = {
            headers: {
                'Authorization': `Bearer ${this.account.token}`,
                'Content-Type': 'application/json'
            }
        };

        if (this.proxy) {
            const proxyUrl = this.proxy.startsWith('http://') || 
                           this.proxy.startsWith('socks4://') || 
                           this.proxy.startsWith('socks5://') ? 
                           this.proxy : `http://${this.proxy}`;

            config.httpsAgent = proxyUrl.startsWith('socks') ? 
                new SocksProxyAgent(proxyUrl) : 
                new HttpsProxyAgent(proxyUrl);
        }

        return config;
    }

    generateDeviceHash() {
        return Math.floor(Date.now() / 1000);
    }

    async toggleDevice() {
        try {
            const payload = {
                walletAddress: this.account.walletAddress,
                state: 'ON',
                deviceHash: this.generateDeviceHash()
            };

            const response = await axios.post(`${this.baseUrls.secApi}/toggle`, payload, this.getAxiosConfig());
            this.logSuccess('Device Toggle', response.data);
            return response.data;
        } catch (error) {
            this.logError('Toggle Error', error);
            throw error;
        }
    }

    async sendHeartbeat() {
        try {
            const deviceHash = this.generateDeviceHash();
            const payload = {
                topic: 'device-heartbeat',
                inputData: {
                    walletAddress: this.account.walletAddress,
                    deviceHash: deviceHash
                }
            };

            const response = await axios.post(`${this.baseUrls.secApi}/produce-to-kafka`, payload, this.getAxiosConfig());
            this.logSuccess('Heartbeat', response.data);
            return response.data;
        } catch (error) {
            this.logError('Heartbeat Error', error);
            throw error;
        }
    }

    async getWalletDetails() {
        try {
            const payload = {
                walletAddress: this.account.walletAddress
            };

            const response = await axios.post(`${this.baseUrls.testnetApi}/walletDetails`, payload, this.getAxiosConfig());

            if (!response.data.error) {
                const details = response.data.details;
                this.logWalletDetails(details);
                return details;
            } else {
                this.logError('Wallet Details', response.data);
                throw new Error('Failed to retrieve wallet details');
            }
        } catch (error) {
            this.logError('Wallet Details Fetch', error);
            throw error;
        }
    }

    async startHeartbeatCycle() {
        try {
            await this.toggleDevice();
            await this.getWalletDetails();

            const timer = setInterval(async () => {
                try {
                    this.uptimeMinutes++;
                    const heartbeatResponse = await this.sendHeartbeat();
                    console.log(chalk.yellow('Kafka Response:'), heartbeatResponse);
                    const walletDetails = await this.getWalletDetails();
                    console.log(chalk.green(`[${new Date().toLocaleTimeString()}] Minute ${this.uptimeMinutes} completed`));
                } catch (cycleError) {
                    this.logError('Heartbeat Cycle', cycleError);
                }
            }, 60000); // Exactly 1 minute

            // Handle graceful shutdown
            process.on('SIGINT', () => {
                clearInterval(timer);
                console.log(chalk.yellow('\nBot stopped. Final uptime:', this.uptimeMinutes, 'minutes'));
                process.exit();
            });
        } catch (error) {
            this.logError('Heartbeat Cycle Start', error);
        }
    }

    logSuccess(action, data) {
        console.log(chalk.green(`[✓] ${action} Success:`), data);
    }

    logError(action, error) {
        console.error(chalk.red(`[✗] ${action} Error:`), 
            error.response ? error.response.data : error.message);
    }

    logWalletDetails(details) {
        const earnings = this.uptimeMinutes * (details.activeRatePerMinute || 0);
        console.log('\n' + chalk.white(`📊 Wallet Details for ${this.account.walletAddress}:`));
        console.log(chalk.cyan(`  Total Earnings: ${details.totalEarnings}`));
        console.log(chalk.cyan(`  Today's Earnings: ${details.todayEarnings}`));
        console.log(chalk.cyan(`  Today's Referral Earnings: ${details.todayReferralEarnings}`));
        console.log(chalk.cyan(`  Today's Uptime Earnings: ${details.todayUptimeEarnings}`));
        console.log(chalk.cyan(`  Active Rate: ${details.activeRatePerMinute} per minute`));
        console.log(chalk.cyan(`  Estimated Session Earnings: ${earnings.toFixed(4)}`));
        console.log(chalk.cyan(`  Uptime: ${this.uptimeMinutes} minutes`));
        console.log(chalk.cyan(`  Rank: ${details.rank}\n`));
    }
}

async function main() {
    try {
        console.log(banner());
        const accounts = await DeviceHeartbeatBot.loadAccounts();
        const proxies = await DeviceHeartbeatBot.loadProxies();

        const bots = accounts.map((account, index) => {
            const proxy = proxies[index % proxies.length];
            return new DeviceHeartbeatBot(account, proxy);
        });

        for (const bot of bots) {
            bot.startHeartbeatCycle();
        }
    } catch (error) {
        console.error(chalk.red('Initialization Error:'), error);
    }
}

main();

export default DeviceHeartbeatBot;