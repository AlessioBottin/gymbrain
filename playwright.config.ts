import {defineConfig} from '@playwright/test'
export default defineConfig({testDir:'./tests/e2e',fullyParallel:false,workers:1,use:{baseURL:'http://127.0.0.1:3001',channel:'chrome',headless:true,trace:'retain-on-failure'},webServer:{command:'npm start',url:'http://127.0.0.1:3001/api/health',reuseExistingServer:false,timeout:60000},outputDir:'preview-artifacts/test-results'})
