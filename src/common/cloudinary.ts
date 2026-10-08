import { v2 as cloudinary } from 'cloudinary';

// This task: menu item images move from local disk (uploads/,
// served via useStaticAssets — see main.ts's prior version and
// docs/PROGRESS.md's Day 16 "known issues") to real online storage, so
// files survive a redeploy and work across multiple API instances.
//
// Cloudinary was chosen after checking the rest of the project for an
// existing storage provider first (package.json, .env.example,
// docker-compose.yml) — nothing was there: no AWS/GCS SDK, no bucket
// config, nothing. Cloudinary was picked over rolling S3/GCS by hand
// because it needs only three env vars and one SDK call to get a
// permanent HTTPS URL back — no bucket/IAM/CORS setup to also invent
// and document for this task. Swapping to S3/GCS/Supabase Storage later
// only touches this file and the two call sites in menu.service.ts that
// use it; the schema field (`imageUrl`, plus `imagePublicId` for
// deletion) and the controller/frontend contract don't change.
//
// `secure: true` forces https:// URLs (never http://) in every response.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };
