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
        this.deviceHash = 1703463647;
        this.toggleState = true;
        this.whitelistedUrls = ["naorisprotocol.network", "google.com"];
        this.isInstalled = true;
        
        // Log proxy information if used
        if (this.proxy) {
            console.log(chalk.blue(`[ðŸŒ] Using Proxy: ${this.proxy}`));
        } else {
            console.log(chalk.yellow(`[âš ï¸] Running without proxy`));
        }
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
            const proxies = proxyData.trim().split('\n').map(line => line.trim());
            console.log(chalk.blue(`[ðŸ“‹] Loaded ${proxies.length} proxies`));
            return proxies;
        } catch (error) {
            console.error(chalk.red('Failed to load proxies:'), error.message);
            return [];
        }
    }

    getAxiosConfig() {
        const config = {
            headers: {
                'Authorization': `Bearer ${this.account.token}`,
                'Content-Type': 'application/json',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Origin': 'chrome-extension://cpikalnagknmlfhnilhfelifgbollmmp',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'none',
                'sec-gpc': '1'
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

    async toggleDevice(state = "ON") {
        try {
            console.log(`Toggle state (${state}) sending to backend...`);
            const payload = {
                walletAddress: this.account.walletAddress,
                state: state,
                deviceHash: this.deviceHash
            };

            const response = await axios.post(
                `${this.baseUrls.secApi}/toggle`,
                payload,
                this.getAxiosConfig()
            );
            
            this.toggleState = state === "ON";
            this.logSuccess('Device Toggle', response.data);
            console.log(`Toggle state (${state}) sent to backend.`);
            return response.data;
        } catch (error) {
            this.logError('Toggle Error', error);
            throw error;
        }
    }

    async sendHeartbeat() {
        try {
            console.log("Message production initiated");
            const payload = {
                topic: 'device-heartbeat',
                inputData: {
                    walletAddress: this.account.walletAddress,
                    deviceHash: this.deviceHash.toString(),
                    isInstalled: this.isInstalled,
                    toggleState: this.toggleState,
                    whitelistedUrls: this.whitelistedUrls
                }
            };

            const response = await axios.post(
                `${this.baseUrls.secApi}/produce-to-kafka`,
                payload,
                this.getAxiosConfig()
            );
            
            console.log("Heartbeat sent to backend.");
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

            const response = await axios.post(
                `${this.baseUrls.testnetApi}/walletDetails`,
                payload,
                this.getAxiosConfig()
            );

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
            // Initial toggle ON
            await this.toggleDevice("ON");
            console.log("Installed script executed successfully!");
            
            // Initial heartbeat
            await this.sendHeartbeat();

            let cycleCount = 0;
            const timer = setInterval(async () => {
                try {
                    cycleCount++;
                    this.uptimeMinutes++;
                    
                    // Simulate service worker wake-up every 5 minutes
                    if (cycleCount % 5 === 0) {
                        console.log("Service worker wake-up alarm triggered.");
                    }

                    if (!this.toggleState) {
                        await this.toggleDevice("ON");
                        console.log("Installed script executed successfully!");
                    }
                    
                    await this.sendHeartbeat();
                    const walletDetails = await this.getWalletDetails();
                    console.log(chalk.green(`[${new Date().toLocaleTimeString()}] Minute ${this.uptimeMinutes} completed`));
                } catch (cycleError) {
                    console.log("Heartbeat stopped.");
                    this.logError('Heartbeat Cycle', cycleError);
                    this.toggleState = false;
                }
            }, 60000); // Every minute

            // Handle shutdown gracefully
            process.on('SIGINT', async () => {
                clearInterval(timer);
                await this.toggleDevice("OFF");
                console.log(chalk.yellow('\nBot stopped. Final uptime:', this.uptimeMinutes, 'minutes'));
                process.exit();
            });
        } catch (error) {
            this.logError('Heartbeat Cycle Start', error);
        }
    }

    logSuccess(action, data) {
        const proxyInfo = this.proxy ? chalk.blue(` [Proxy: ${this.proxy}]`) : '';
        console.log(chalk.green(`[âœ“] ${action} Success:${proxyInfo}`), data);
    }

    logError(action, error) {
        const proxyInfo = this.proxy ? chalk.blue(` [Proxy: ${this.proxy}]`) : '';
        console.error(chalk.red(`[âœ—] ${action} Error:${proxyInfo}`), 
            error.response ? error.response.data : error.message);
    }

    logWalletDetails(details) {
        const earnings = this.uptimeMinutes * (details.activeRatePerMinute || 0);
        const proxyInfo = this.proxy ? chalk.blue(`\n  Proxy: ${this.proxy}`) : '';
        
        console.log('\n' + chalk.white(`ðŸ“Š Wallet Details for ${this.account.walletAddress}:`));
        console.log(chalk.cyan(`  Total Earnings: ${details.totalEarnings}`));
        console.log(chalk.cyan(`  Today's Earnings: ${details.todayEarnings}`));
        console.log(chalk.cyan(`  Today's Referral Earnings: ${details.todayReferralEarnings}`));
        console.log(chalk.cyan(`  Today's Uptime Earnings: ${details.todayUptimeEarnings}`));
        console.log(chalk.cyan(`  Active Rate: ${details.activeRatePerMinute} per minute`));
        console.log(chalk.cyan(`  Estimated Session Earnings: ${earnings.toFixed(4)}`));
        console.log(chalk.cyan(`  Uptime: ${this.uptimeMinutes} minutes`));
        console.log(chalk.cyan(`  Rank: ${details.rank}${proxyInfo}\n`));
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
