// ==UserScript==
// @name         Strava Cookie Syncer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automatically syncs Strava cookies to Cloudflare Worker Secret
// @author       You
// @match        https://www.strava.com/*
// @connect      api.cloudflare.com
// @grant        GM_cookie
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_log
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG_KEYS = {
        ACCOUNT_ID: 'CF_ACCOUNT_ID',
        API_TOKEN: 'CF_API_TOKEN',
        SCRIPT_NAME: 'CF_SCRIPT_NAME'
    };

    const REQUIRED_COOKIES = [
        '_strava4_session',
        'CloudFront-Policy',
        'CloudFront-Key-Pair-Id',
        'CloudFront-Signature'
    ];

    function getStoredConfig() {
        return {
            accountId: GM_getValue(CONFIG_KEYS.ACCOUNT_ID),
            apiToken: GM_getValue(CONFIG_KEYS.API_TOKEN),
            scriptName: GM_getValue(CONFIG_KEYS.SCRIPT_NAME) || 'strava-heatmap-proxy'
        };
    }

    function promptForConfig() {
        const config = getStoredConfig();

        const accountId = prompt('Enter Cloudflare Account ID:', config.accountId || '');
        if (accountId === null) return;

        const apiToken = prompt('Enter Cloudflare API Token:', config.apiToken || '');
        if (apiToken === null) return;

        const scriptName = prompt('Enter Cloudflare Worker Script Name:', config.scriptName);
        if (scriptName === null) return;

        GM_setValue(CONFIG_KEYS.ACCOUNT_ID, accountId);
        GM_setValue(CONFIG_KEYS.API_TOKEN, apiToken);
        GM_setValue(CONFIG_KEYS.SCRIPT_NAME, scriptName);

        GM_notification('Configuration saved. Sync will run on next page load.', 'Strava Cookie Syncer');
    }

    GM_registerMenuCommand('Configure Cloudflare Credentials', promptForConfig);

    async function getStravaCookies() {
        return new Promise((resolve, reject) => {
            GM_cookie.list({ domain: '.strava.com' }, (cookies, error) => {
                if (error) {
                    reject(error);
                    return;
                }

                // Filter and format cookies
                const filtered = cookies.filter(c => REQUIRED_COOKIES.includes(c.name));
                // We also want to capture the session cookie even if CloudFront ones are missing,
                // as the worker can now use the session to refresh them.

                const cookieString = filtered.map(c => `${c.name}=${c.value}`).join('; ');
                resolve(cookieString);
            });
        });
    }

    async function updateCloudflareSecret(cookieString) {
        const config = getStoredConfig();
        if (!config.accountId || !config.apiToken || !config.scriptName) {
            GM_log('Missing configuration. Please configure via user script menu.');
            return;
        }

        const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/workers/scripts/${config.scriptName}/secrets`;

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'PUT',
                url: url,
                headers: {
                    'Authorization': `Bearer ${config.apiToken}`,
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify({
                    name: 'STRAVA_COOKIES',
                    text: cookieString,
                    type: 'secret_text'
                }),
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response);
                    } else {
                        reject(new Error(`Failed to update secret: ${response.status} ${response.responseText}`));
                    }
                },
                onerror: function(error) {
                    reject(error);
                }
            });
        });
    }

    async function main() {
        const config = getStoredConfig();
        if (!config.accountId || !config.apiToken) {
            // First run or missing config
            console.log('Strava Cookie Syncer: Config missing.');
            return;
        }

        try {
            const currentCookies = await getStravaCookies();

            // Check if we have the critical session cookie
            if (!currentCookies.includes('_strava4_session')) {
                console.log('Strava Cookie Syncer: _strava4_session not found. Are you logged in?');
                return;
            }

            const lastUploaded = GM_getValue('last_uploaded_cookies');
            const lastUploadTime = GM_getValue('last_upload_time') || 0;
            const now = Date.now();
            const ONE_HOUR = 60 * 60 * 1000;

            // Check if we should update
            // 1. If cookies content changed significantly (implied by comparing strings)
            // 2. AND enough time has passed (throttling)

            const hasChanged = currentCookies !== lastUploaded;
            const timeDiff = now - lastUploadTime;
            const throttled = timeDiff < ONE_HOUR;

            if (hasChanged) {
                if (throttled) {
                    console.log(`Strava Cookie Syncer: Cookies changed, but throttling updates (Last update: ${Math.round(timeDiff/60000)} mins ago).`);
                } else {
                    console.log('Strava Cookie Syncer: Cookies changed. Updating Cloudflare...');
                    await updateCloudflareSecret(currentCookies);
                    GM_setValue('last_uploaded_cookies', currentCookies);
                    GM_setValue('last_upload_time', now);
                    GM_notification('Strava cookies updated successfully.', 'Strava Cookie Syncer');
                }
            } else {
                console.log('Strava Cookie Syncer: Cookies unchanged. Skipping update.');
            }

        } catch (err) {
            console.error('Strava Cookie Syncer Error:', err);
            GM_log('Error: ' + err.message);
        }
    }

    // Run on page load (with a slight delay to ensure cookies are settled)
    setTimeout(main, 2000);

})();
