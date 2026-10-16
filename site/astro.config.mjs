// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';

const site = 'https://india2actual.emil.ge';

export default defineConfig({
  site,
  integrations: [
    // The Convert page is built outside Astro, so it is added by hand.
    sitemap({ customPages: [`${site}/convert/`] }),
    starlight({
      title: 'india2actual',
      description:
        'Import Indian bank and credit card statements into Actual Budget, with real payee names instead of UPI reference strings.',
      components: {
        PageFrame: './src/components/PageFrame.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        Hero: './src/components/Hero.astro',
      },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        { label: 'Convert in your browser', link: '/convert/' },
        { label: 'Documentation', slug: 'docs' },
        { label: 'Changelog', slug: 'changelog' },
        { label: 'Privacy', slug: 'privacy' },
      ],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/emilgeo/india2actual',
        },
        {
          icon: 'npm',
          label: 'npm',
          href: 'https://www.npmjs.com/package/india2actual',
        },
      ],
      head: [
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: `${site}/og-image.png` },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: 'summary_large_image' },
        },
      ],
    }),
  ],
});
