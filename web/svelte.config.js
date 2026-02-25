import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
        kit: {
                adapter: adapter({
                        pages: '../dist/web',
                        assets: '../dist/web',
                        fallback: 'index.html',
                        precompress: false,
                        strict: true
                }),
                alias: {
                        $lib: './src/lib',
                        $components: './src/lib/components',
                        $utils: './src/lib/utils'
                }
        }
};

export default config;
