(function (h, u, b, s, p, o, t) {
    if (!u.getElementById(b)) {
        const trackingID = '<TO_REPLACE_SCRIPT_LOADER_ID>';

        const scriptLoaderURL = '//js.hs-scripts.com/' + trackingID + '.js';
        s = u.getElementsByTagName('head')[0];
        p = u.createElement('script');
        p.src = scriptLoaderURL;
        p.type = 'text/javascript';
        p.id = b;
        p.async = 1;
        p.defer = 1;
        s.appendChild(p);
        o = h._hsp = h._hsp || [];
        o.push(['setContentType', 'knowledge-article']);
    }
})(window, document, 'hs-script-loader');
