import { defineConfig } from 'vite'
import adonisjs from '@adonisjs/vite/client'

export default defineConfig({
  plugins: [
    adonisjs({
      entryPoints: ['./assets/app.js', './assets/app.css'],
      assets: {
        chunks: ['content/**/*.(png|jpg|jpeg)'],
      },
      reload: ['content/**/*', 'templates/**/*.edge'],
    }),
  ],
})
