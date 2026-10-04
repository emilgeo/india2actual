// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const site = 'https://india2actual.emil.ge';

export default defineConfig({
  site,
  integrations: [
    starlight({
      title: 'india2actual',
      description:
        'Import Indian bank and credit card statements into Actual Budget, with real payee names instead of UPI reference strings.',
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        { label: 'Documentation', slug: 'docs' },
        { label: 'Changelog', slug: 'changelog' },
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
