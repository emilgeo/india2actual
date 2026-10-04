// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://india2actual.emil.ge',
  integrations: [
    starlight({
      title: 'india2actual',
      description:
        'Import Indian bank and credit card statements into Actual Budget, with real payee names instead of UPI reference strings.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/emilgeo/india2actual',
        },
      ],
    }),
  ],
});
