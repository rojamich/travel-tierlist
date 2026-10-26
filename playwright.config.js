import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',fullyParallel:true,
  use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure',
    launchOptions:process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{}},
  projects:[{name:'android-phone',use:{...devices['Pixel 7']}},{name:'desktop',use:{viewport:{width:1280,height:900}}}],
  webServer:{command:'npm run preview -- --port 4173',port:4173,reuseExistingServer:!process.env.CI}
});
