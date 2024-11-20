import * as jwt from '@tsndr/cloudflare-worker-jwt';
import { Router } from 'itty-router';

import { IntegrationInstallationConfiguration } from '@gitbook/api';
import {
    createIntegration,
    FetchEventCallback,
    Logger,
    RuntimeContext,
    RuntimeEnvironment,
    createComponent,
    ExposableError,
} from '@gitbook/runtime';

const logger = Logger('okta.visitor-auth');

type OktaRuntimeEnvironment = RuntimeEnvironment<{}, OktaSiteInstallationConfiguration>;

type OktaRuntimeContext = RuntimeContext<OktaRuntimeEnvironment>;

type OktaSiteInstallationConfiguration = {
    client_id?: string;
    okta_domain?: string;
    client_secret?: string;
};

type OktaState = OktaSiteInstallationConfiguration;

type OktaProps = {
    installation: {
        configuration?: IntegrationInstallationConfiguration;
    };
    siteInstallation?: {
        configuration?: OktaSiteInstallationConfiguration;
    };
};

type OktaTokenResponseData = {
    access_token?: string;
    refresh_token?: string;
    token_type: 'Bearer';
    expires_in: number;
};

type OktaTokenResponseError = {
    error: string;
    error_description: string;
};

export type OktaAction = { action: 'save.config' };

const configBlock = createComponent<OktaProps, OktaState, OktaAction, OktaRuntimeContext>({
    componentId: 'config',
    initialState: (props) => {
        const siteInstallation = props.siteInstallation;
        return {
            client_id: siteInstallation?.configuration?.client_id || '',
            okta_domain: siteInstallation?.configuration?.okta_domain || '',
            client_secret: siteInstallation?.configuration?.client_secret || '',
        };
    },
    action: async (element, action, context) => {
        switch (action.action) {
            case 'save.config':
                const { api, environment } = context;
                const siteInstallation = assertSiteInstallation(environment);

                const configurationBody = {
                    ...siteInstallation.configuration,
                    client_id: element.state.client_id,
                    client_secret: element.state.client_secret,
                    okta_domain: element.state.okta_domain,
                };
                await api.integrations.updateIntegrationSiteInstallation(
                    siteInstallation.integration,
                    siteInstallation.installation,
                    siteInstallation.site,
                    {
                        configuration: {
                            ...configurationBody,
                        },
                    },
                );

                return { type: 'complete' };
        }
    },
    render: async (element, context) => {
        const siteInstallation = context.environment.siteInstallation;
        const VACallbackURL = `${siteInstallation?.urls?.publicEndpoint}/visitor-auth/response`;
        return (
            <block>
                <input
                    label="Client ID"
                    hint={
                        <text>
                            The Client ID of your Okta application.
                            <link
                                target={{
                                    url: 'https://developer.okta.com/docs/guides/find-your-app-credentials/main/#find-your-app-integration-credentials',
                                }}
                            >
                                {' '}
                                More Details
                            </link>
                        </text>
                    }
                    element={<textinput state="client_id" placeholder="Client ID" />}
                />

                <input
                    label="Okta Domain"
                    hint={
                        <text>
                            The Domain of your Okta instance.
                            <link
                                target={{
                                    url: 'https://developer.okta.com/docs/guides/find-your-domain/main/',
                                }}
                            >
                                {' '}
                                More Details
                            </link>
                        </text>
                    }
                    element={<textinput state="okta_domain" placeholder="Okta Domain" />}
                />

                <input
                    label="Client Secret"
                    hint={
                        <text>
                            The Client Secret of your Okta application.
                            <link
                                target={{
                                    url: 'https://developer.okta.com/docs/guides/find-your-app-credentials/main/#find-your-app-integration-credentials',
                                }}
                            >
                                {' '}
                                More Details
                            </link>
                        </text>
                    }
                    element={<textinput state="client_secret" placeholder="Client Secret" />}
                />
                <divider size="medium" />
                <hint>
                    <text style="bold">
                        The following URL needs to be saved as a Sign-In Redirect URI in Okta:
                    </text>
                </hint>
                <codeblock content={VACallbackURL} />
                <input
                    label=""
                    hint=""
                    element={
                        <button
                            style="primary"
                            disabled={false}
                            label="Save"
                            tooltip="Save configuration"
                            onPress={{
                                action: 'save.config',
                            }}
                        />
                    }
                />
            </block>
        );
    },
});

/**
 * Get the published content (site or space) related urls.
 */
async function getPublishedContentUrls(context: OktaRuntimeContext) {
    const organizationId = assertOrgId(context.environment);
    const siteInstallation = assertSiteInstallation(context.environment);
    const publishedContentData = await context.api.orgs.getSiteById(
        organizationId,
        siteInstallation.site,
    );

    return publishedContentData.data.urls;
}

function assertSiteInstallation(environment: OktaRuntimeEnvironment) {
    const siteInstallation = environment.siteInstallation;
    if (!siteInstallation) {
        throw new Error('No site installation found');
    }

    return siteInstallation;
}

function assertOrgId(environment: OktaRuntimeEnvironment) {
    const orgId = environment.installation?.target?.organization!;
    if (!orgId) {
        throw new Error('No org ID found');
    }

    return orgId;
}

const handleFetchEvent: FetchEventCallback<OktaRuntimeContext> = async (request, context) => {
    const { environment } = context;
    const siteInstallation = assertSiteInstallation(environment);
    const installationURL = siteInstallation.urls?.publicEndpoint;
    if (installationURL) {
        const router = Router({
            base: new URL(installationURL).pathname,
        });

        router.get('/visitor-auth/response', async (request) => {
            if ('site' in siteInstallation && siteInstallation.site) {
                const publishedContentUrls = await getPublishedContentUrls(context);

                const oktaDomain = siteInstallation.configuration.okta_domain;
                const clientId = siteInstallation.configuration.client_id;
                const clientSecret = siteInstallation.configuration.client_secret;

                if (!clientId || !clientSecret || !oktaDomain) {
                    return new Response(
                        'Error: Either client id, client secret or okta domain is missing',
                        {
                            status: 400,
                        },
                    );
                }

                const searchParams = new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: clientId,
                    client_secret: clientSecret,
                    code: `${request.query.code}`,
                    redirect_uri: `${installationURL}/visitor-auth/response`,
                });
                const accessTokenURL = `https://${oktaDomain}/oauth2/v1/token/`;
                const oktaTokenResp = await fetch(accessTokenURL, {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body: searchParams,
                });

                if (!oktaTokenResp.ok) {
                    const errorResponse = await oktaTokenResp.json<OktaTokenResponseError>();
                    logger.debug(JSON.stringify(errorResponse, null, 2));
                    logger.debug(
                        `Did not receive access token. Error: ${(errorResponse && errorResponse.error) || ''} ${
                            (errorResponse && errorResponse.error_description) || ''
                        }`,
                    );
                    return new Response('Error: Could not fetch token from Okta', {
                        status: 401,
                    });
                }

                const oktaTokenData = await oktaTokenResp.json<OktaTokenResponseData>();
                if (!oktaTokenData.access_token) {
                    return new Response('Error: No Access Token found in response from Okta', {
                        status: 401,
                    });
                }

                // Okta already include user/custom claims in the access token so we can just decode it
                const decodedOktaToken = await jwt.decode(oktaTokenData.access_token);
                try {
                    const privateKey = context.environment.signingSecrets.siteInstallation;
                    if (!privateKey) {
                        return new Response('Error: Missing private key from site installation', {
                            status: 400,
                        });
                    }
                    const jwtToken = await jwt.sign(
                        {
                            ...sanitizeJWTTokenClaims(decodedOktaToken.payload || {}),
                            exp: Math.floor(Date.now() / 1000) + 1 * (60 * 60),
                        },
                        privateKey,
                    );

                    const publishedContentUrl = publishedContentUrls?.published;
                    if (!publishedContentUrl || !jwtToken) {
                        return new Response(
                            "Error: Either JWT token or site's published URL is missing",
                            {
                                status: 500,
                            },
                        );
                    }

                    const state = request.query.state?.toString();
                    const location = state ? state.substring(state.indexOf('-') + 1) : '';
                    const url = new URL(`${publishedContentUrl}${location || ''}`);
                    url.searchParams.append('jwt_token', jwtToken);

                    return Response.redirect(url.toString());
                } catch (e) {
                    return new Response('Error: Could not sign JWT token', {
                        status: 500,
                    });
                }
            }
        });

        let response;
        try {
            response = await router.handle(request, context);
        } catch (error: any) {
            logger.error('error handling request', error);
            return new Response(error.message, {
                status: error.status || 500,
            });
        }

        if (!response) {
            return new Response(`No route matching ${request.method} ${request.url}`, {
                status: 404,
            });
        }

        return response;
    }
};

export default createIntegration({
    fetch: handleFetchEvent,
    components: [configBlock],
    fetch_visitor_authentication: async (event, context) => {
        const { environment } = context;
        const siteInstallation = assertSiteInstallation(environment);

        const installationURL = siteInstallation.urls.publicEndpoint;
        const configuration = siteInstallation.configuration;

        const oktaDomain = configuration.okta_domain;
        const clientId = configuration.client_id;
        const location = event.location ? event.location : '';

        if (!clientId || !oktaDomain) {
            throw new ExposableError('OIDC configuration is missing');
        }

        const url = new URL(`https://${oktaDomain}/oauth2/v1/authorize`);
        url.searchParams.append('client_id', clientId);
        url.searchParams.append('response_type', 'code');
        url.searchParams.append('redirect_uri', `${installationURL}/visitor-auth/response`);
        url.searchParams.append('response_mode', 'query');
        url.searchParams.append('scope', 'openid');
        url.searchParams.append('state', `state-${location}`);

        return Response.redirect(url.toString());
    },
});

function sanitizeJWTTokenClaims(claims: jwt.JwtPayload) {
    const result: Record<string, any> = {};

    Object.entries(claims).forEach(([key, value]) => {
        if (['iat', 'exp'].includes(key)) {
            return;
        }
        result[key] = value;
    });
    return result;
}
