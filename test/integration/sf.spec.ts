import "mocha";
import {expect} from "chai";
import {Storefront} from "../../src/storefront";
import request from "supertest";
import {createGateway} from "../mock/mock";
import {RENDER_MODE_QUERY_NAME} from "../../src/config";
import {CONTENT_REPLACE_SCRIPT, EVENTS, FRAGMENT_RENDER_MODES} from "../../src/enums";
import nock from "nock";
import {IStorefrontConfig} from "../../src/types";
import faker from "faker";

const commonStorefrontConfiguration = {
    gateways: [],
    port: 4448,
    pages: [],
    url: 'http://localhost:4448',
    dependencies: []
} as IStorefrontConfig;


describe('Storefront', () => {
    it('should create a new storefront instance', () => {
        const sf = new Storefront(commonStorefrontConfiguration);

        expect(sf).to.be.instanceOf(Storefront);
    });

    it('should respond 200 from healthcheck path when storefront is ready', (done) => {
        const sf = new Storefront(commonStorefrontConfiguration);

        sf.init(() => {
            request('http://localhost:4448')
                .get('/healthcheck')
                .expect(200).end((err) => {
                sf.server.close();
                done(err);
            });
        });
    });

    it('should add page routes and respond correctly', (done) => {
        const scope = createGateway('Browsing', 'http://localhost:4446', {
            fragments: {
                'product':
                    {
                        assets: [],
                        dependencies: [],
                        render: {
                            url: '/',
                        },
                        testCookie: 'sdasd',
                        version: '1.0.0'
                    }
            },
            hash: '12345'
        }, false)
            .get('/product/')
            .query({[RENDER_MODE_QUERY_NAME]: FRAGMENT_RENDER_MODES.STREAM})
            .reply(200, {
                main: 'Product Content'
            });

        const sf = new Storefront({
            ...commonStorefrontConfiguration,
            gateways: [
                {
                    name: "Browsing",
                    url: "http://localhost:4446"
                }
            ],
            pages: [
                {
                    url: '/',
                    html: '<template><div><html><head></head><body><fragment from="Browsing" name="product"/></div></body></html></template>'
                }
            ]
        });

        sf.init(() => {
            request('http://localhost:4448')
                .get('/')
                .expect(200)
                .end((err, res) => {

                    sf.server.close();
                    Object.values(sf.gateways).forEach(gateway => {
                        gateway.stopUpdating();
                    });

                    expect(res.text).to.eq(`<div><html><head>${CONTENT_REPLACE_SCRIPT}</head><body><div id="product" puzzle-fragment="product" puzzle-gateway="Browsing" puzzle-chunk="product_main"></div></div><div style="display: none;" puzzle-fragment="product" puzzle-chunk-key="product_main">Product Content</div><script>$p('[puzzle-chunk="product_main"]','[puzzle-chunk-key="product_main"]');</script></body></html>`);
                    done(err);
                });
        });
    });

    it('should track gateway updates and respond with updated configuration', (done) => {
        const hash_nock = (placeholder: boolean, hash: string) => {
            return nock('http://localhost:4446')
                .persist(true)
                .get('/')
                .reply(200, {
                    fragments: {
                        'product':
                            {
                                assets: [],
                                dependencies: [],
                                render: {
                                    url: '/',
                                    placeholder
                                },
                                testCookie: 'sdasd',
                                version: '1.0.0'
                            }
                    },
                    hash: hash
                })
                .get('/product/')
                .query({[RENDER_MODE_QUERY_NAME]: FRAGMENT_RENDER_MODES.STREAM})
                .reply(200, {
                    main: 'Product Content'
                })
                .get('/product/placeholder')
                .reply(200, 'Product Placeholder');
        };

        hash_nock(false, 'disabled');

        const sf = new Storefront({
            ...commonStorefrontConfiguration,
            gateways: [
                {
                    name: "Browsing",
                    url: "http://localhost:4446"
                }
            ],
            pages: [
                {
                    url: '/',
                    html: '<template><div><html><head></head><body><fragment from="Browsing" name="product"/></div></body></html></template>'
                }
            ]
        });

        sf.init(() => {
            request('http://localhost:4448')
                .get('/')
                .expect(200)
                .end((err, res) => {
                    expect(res.text).to.eq(`<div><html><head>${CONTENT_REPLACE_SCRIPT}</head><body><div id="product" puzzle-fragment="product" puzzle-gateway="Browsing" puzzle-chunk="product_main"></div></div><div style="display: none;" puzzle-fragment="product" puzzle-chunk-key="product_main">Product Content</div><script>$p('[puzzle-chunk="product_main"]','[puzzle-chunk-key="product_main"]');</script></body></html>`);
                    nock.cleanAll();
                    hash_nock(true, 'enabled');

                    sf.gateways['Browsing'].events.once(EVENTS.GATEWAY_UPDATED, () => {
                        request('http://localhost:4448')
                            .get('/')
                            .expect(200)
                            .end((err, res) => {
                                sf.server.close();
                                Object.values(sf.gateways).forEach(gateway => {
                                    gateway.stopUpdating();
                                });
                                nock.cleanAll();

                                expect(res.text).to.eq(`<div><html><head>${CONTENT_REPLACE_SCRIPT}</head><body><div id="product" puzzle-fragment="product" puzzle-gateway="Browsing" puzzle-chunk="product_main" puzzle-placeholder="product_main_placeholder">Product Placeholder</div></div><div style="display: none;" puzzle-fragment="product" puzzle-chunk-key="product_main">Product Content</div><script>$p('[puzzle-chunk="product_main"]','[puzzle-chunk-key="product_main"]');</script></body></html>`);

                                done();
                            });

                    });
                });
        });
    });

    it('should respond with same status code gateway returned for primary fragments', (done) => {
        const scope = createGateway('Browsing', 'http://localhost:4446', {
            fragments: {
                'product':
                    {
                        assets: [],
                        dependencies: [],
                        render: {
                            url: '/',
                        },
                        testCookie: 'sdasd',
                        version: '1.0.0'
                    }
            },
            hash: '12345'
        }, false)
            .get('/product/')
            .query({[RENDER_MODE_QUERY_NAME]: FRAGMENT_RENDER_MODES.STREAM})
            .reply(404, {
                main: 'Product Content Not Found'
            });

        const sf = new Storefront({
            ...commonStorefrontConfiguration,
            gateways: [
                {
                    name: "Browsing",
                    url: "http://localhost:4446"
                }
            ],
            pages: [
                {
                    url: '/',
                    html: '<template><div><html><head></head><body><fragment from="Browsing" name="product" primary/></div></body></html></template>'
                }
            ]
        });

        sf.init(() => {
            request('http://localhost:4448')
                .get('/')
                .expect(404)
                .end((err, res) => {

                    sf.server.close();
                    Object.values(sf.gateways).forEach(gateway => {
                        gateway.stopUpdating();
                    });

                    expect(res.text).to.eq(`<div><html><head/><body><div id="product" puzzle-fragment="product" puzzle-gateway="Browsing">Product Content Not Found</div></body></html></div>`);
                    done(err);
                });
        });
    });

    it('should add multiple routes for pages with optional params', (done) => {
        const fragment ={
            name: faker.random.word(),
            testCookie: faker.random.word(),
            hash: faker.random.uuid()
        };
        const scope = createGateway('Browsing', 'http://localhost:4446', {
            fragments: {
                [fragment.name]:
                    {
                        assets: [],
                        dependencies: [],
                        render: {
                            url: '/',
                        },
                        testCookie: fragment.testCookie,
                        version: '1.0.0'
                    }
            },
            hash: fragment.hash
        }, true)
            .get(`/${fragment.name}/detail`)
            .query({[RENDER_MODE_QUERY_NAME]: FRAGMENT_RENDER_MODES.STREAM})
            .reply(200, {
                main: `Fragment: ${fragment.name}`
            });

        const sf = new Storefront({
            ...commonStorefrontConfiguration,
            gateways: [
                {
                    name: "Browsing",
                    url: "http://localhost:4446"
                }
            ],
            pages: [
                {
                    url: ['/', '/detail'],
                    html: `<template><html><head></head><body><fragment from="Browsing" name="${fragment.name}" primary/></div></body></html></template>`
                }
            ]
        });

        sf.init(() => {
            request('http://localhost:4448')
                .get('/detail')
                .expect(200)
                .end((err, res) => {
                    sf.server.close();
                    Object.values(sf.gateways).forEach(gateway => {
                        gateway.stopUpdating();
                    });

                    expect(res.text).to.eq(`<html><head/><body><div id="${fragment.name}" puzzle-fragment="${fragment.name}" puzzle-gateway="Browsing">Fragment: ${fragment.name}</div></body></html>`);
                    done(err);
                });
        });
    });
});
