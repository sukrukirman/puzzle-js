import md5 from "md5";
import {EventEmitter} from "events";
import {FragmentBFF} from "./fragment";
import {DEFAULT_MAIN_PARTIAL, EVENTS, FRAGMENT_RENDER_MODES, HTTP_METHODS} from "./enums";
import {IExposeConfig, IGatewayBFFConfiguration, IGatewayConfiguration} from "../types/gateway";
import fetch from "node-fetch";
import {IExposeFragment} from "../types/fragment";
import Timer = NodeJS.Timer;
import {DEFAULT_POLLING_INTERVAL, PREVIEW_PARTIAL_QUERY_NAME, RENDER_MODE_QUERY_NAME} from "./config";
import async from "async";
import {Server} from "./server";

export class Gateway {
    name: string;
    url: string;
    server: Server = new Server();

    constructor(gatewayConfig: IGatewayConfiguration) {
        this.name = gatewayConfig.name;
        this.url = gatewayConfig.url;
    }
}

export class GatewayStorefrontInstance extends Gateway {
    events: EventEmitter = new EventEmitter();
    config: IExposeConfig | undefined;
    private intervalId: Timer | null = null;

    constructor(gatewayConfig: IGatewayConfiguration) {
        super(gatewayConfig);

        this.fetch();
    }

    /**
     * Starts updating gateway by polling with the provided miliseconds
     * @param {number} pollingInterval
     */
    startUpdating(pollingInterval: number = DEFAULT_POLLING_INTERVAL) {
        this.intervalId = setInterval(this.fetch.bind(this), pollingInterval);
    }

    /**
     * Stops udpating gateway
     */
    stopUpdating() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }

    /**
     * Fetches gateway condifuration and calls this.bind
     */
    private fetch() {
        fetch(this.url)
            .then(res => res.json())
            .then(this.update.bind(this))
            .catch(e => {
                //todo error handling
                //console.error(e)
            });
    }

    /**
     * Updates gateway configuration and if hash changed emits GATEWAY_UPDATED event
     * @param {IExposeConfig} data
     */
    private update(data: IExposeConfig) {
        if (!this.config) {
            this.config = data;
            this.events.emit(EVENTS.GATEWAY_READY, this);
        } else {
            if (data.hash !== this.config.hash) {
                this.config = data;
                this.events.emit(EVENTS.GATEWAY_UPDATED, this);
            }
        }
    }
}

export class GatewayBFF extends Gateway {
    exposedConfig: IExposeConfig;
    private config: IGatewayBFFConfiguration;
    private fragments: { [name: string]: FragmentBFF } = {};

    constructor(gatewayConfig: IGatewayBFFConfiguration) {
        super(gatewayConfig);
        this.config = gatewayConfig;
        this.exposedConfig = this.createExposeConfig();
        this.exposedConfig.hash = md5(JSON.stringify(this.exposedConfig));
    }

    public init(cb?: Function) {
        async.series([
            this.addFragmentRoutes.bind(this),
            this.addConfigurationRoute.bind(this),
            this.addHealtcheckRoute.bind(this)
        ], err => {
            if (!err) {
                this.server.listen(this.config.port, cb);
            } else {
                throw err;
            }
        });
    }

    private createExposeConfig() {
        return {
            fragments: this.config.fragments.reduce((fragmentList: { [name: string]: IExposeFragment }, fragment) => {
                //todo test cookieler calismiyor, versiyonlara gore build edilmeli asset ve dependency configleri
                fragmentList[fragment.name] = {
                    version: fragment.version,
                    render: fragment.render,
                    assets: fragment.versions[fragment.version].assets,
                    dependencies: fragment.versions[fragment.version].dependencies,
                    testCookie: fragment.testCookie,
                };

                this.fragments[fragment.name] = new FragmentBFF(fragment);

                return fragmentList;
            }, {}),
            hash: '',
        };
    }

    /**
     * Renders a fragment with desired version and renderMode
     * @param {string} fragmentName
     * @param {FRAGMENT_RENDER_MODES} renderMode
     * @param {string} cookieValue
     * @returns {Promise<string>}
     */
    async renderFragment(fragmentName: string, renderMode: FRAGMENT_RENDER_MODES = FRAGMENT_RENDER_MODES.PREVIEW, partial: string, cookieValue?: string): Promise<string> {
        if (this.fragments[fragmentName]) {
            const fragmentContent = await this.fragments[fragmentName].render({}, cookieValue);
            switch (renderMode) {
                case FRAGMENT_RENDER_MODES.STREAM:
                    return JSON.stringify(fragmentContent);
                case FRAGMENT_RENDER_MODES.PREVIEW:
                    return this.wrapFragmentContent(fragmentContent[partial], fragmentName);
                default:
                    return JSON.stringify(fragmentContent);
            }
        } else {
            throw new Error(`Failed to find fragment: ${fragmentName}`);
        }
    }

    /**
     * Wraps with html template for preview mode
     * @param {string} htmlContent
     * @param {string} fragmentName
     * @returns {string}
     */
    private wrapFragmentContent(htmlContent: string, fragmentName: string) {
        return `<html><head><title>${this.config.name} - ${fragmentName}</title>${this.config.isMobile ? '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />' : ''}</head><body>${htmlContent}</body></html>`;
    }

    private addFragmentRoutes(cb: Function) {
        this.config.fragments.forEach(fragmentConfig => {
            this.server.addRoute(`/${fragmentConfig.name}${fragmentConfig.render.url}`, HTTP_METHODS.GET, async (req, res) => {
                const renderMode = req.query[RENDER_MODE_QUERY_NAME] === FRAGMENT_RENDER_MODES.STREAM ? FRAGMENT_RENDER_MODES.STREAM : FRAGMENT_RENDER_MODES.PREVIEW;
                const gatewayContent = await this.renderFragment(fragmentConfig.name, renderMode, req.query[PREVIEW_PARTIAL_QUERY_NAME] || DEFAULT_MAIN_PARTIAL, req.cookies[fragmentConfig.testCookie]);

                if (renderMode === FRAGMENT_RENDER_MODES.STREAM) {
                    res.set('content-type', 'application/json');
                    res.status(200).end(gatewayContent);
                }else{
                    res.status(200).end(gatewayContent);
                }
            });
        });

        cb();
    }

    private addHealtcheckRoute(cb: Function) {
        this.server.addRoute('/healthcheck', HTTP_METHODS.GET, (req, res) => {
            res.status(200).end();
        });
        cb();
    }

    private addConfigurationRoute(cb: Function) {
        this.server.addRoute('/', HTTP_METHODS.GET, (req, res) => {
            res.status(200).json(this.exposedConfig);
        });
        cb();
    }
}
