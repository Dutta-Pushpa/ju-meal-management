$env:DATABASE_URL='postgresql://ju_meal:ju_meal_dev_password@localhost:5432/ju_meal'
$env:DATABASE_ADMIN_URL='postgresql://ju_meal:ju_meal_dev_password@localhost:5432/ju_meal'
$env:NODE_ENV='development'
cd 'f:\ju-meal-management'
npm run start --workspace server
