require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');
const path = require('path');
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 5000;

// Conditional CORS for dev only
if (process.env.NODE_ENV !== 'production') {
  app.use(cors({ origin: 'http://localhost:3000' }));
} else {
  app.use(cors()); // optional: allow all in production or remove
}

// Other middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// PostgreSQL pool
const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: isProduction
    ? { rejectUnauthorized: false }
    : false
});

// console.log(`Running in ${process.env.NODE_ENV}, SSL: ${JSON.stringify(isProduction ? { rejectUnauthorized: false } : false)}`);

pool.query('SELECT NOW()', (err, result) => {
  if (err) {
    console.error('❌ DB connection failed:', err.message);
  } else {
    console.log('✅ Connected to DB at:', result.rows[0].now);
  }
});

app.get('/api/history', (req, res) => {
  const reporterName = req.query.reporter_name;

  if (!reporterName) {
    return res.status(400).json({ error: 'Missing reporter_name query parameter' });
  }

  pool.query(
    'SELECT * FROM culvert_surveys WHERE reporter_name = $1 ORDER BY timestamp DESC',
    [reporterName],
    (err, result) => {
      if (err) {
        console.error('❌ DB query failed:', err.message);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(result.rows);
    }
  );
});

app.post(
  '/api/submit',
  upload.fields([
    { name: 'inlet_photo', maxCount: 1 },
    { name: 'outlet_photo', maxCount: 1 },
    { name: 'ditch_photo', maxCount: 1 },
    { name: 'drain_photo', maxCount: 1 },
    { name: 'additional_photos', maxCount: 5 }
  ]),
  async (req, res) => {

    const data = req.body;
    const files = req.files;

    const inletPhoto = files?.inlet_photo?.[0]?.buffer || null;
    const outletPhoto = files?.outlet_photo?.[0]?.buffer || null;
    const ditchPhoto = files?.ditch_photo?.[0]?.buffer || null;
    const drainPhoto = files?.drain_photo?.[0]?.buffer || null;

    try {
      // Insert into culvert_surveys and return survey_id
      const result = await pool.query(
        `INSERT INTO culvert_surveys (
          reporter_name, report_type, latitude, longitude,
          culvert_type, culvert_diameter, water_flow, culvert_blockage,
          header_condition, inlet_condition, outlet_condition,
          ownership, additional_info, inlet_photo, outlet_photo, ditch_photo, drain_photo, timestamp,
          perched_status, road_condition,
          ditch_adjacent, ditch_adjacent_other,
          ditch_water, ditch_water_other,
          ditch_vegetation, ditch_vegetation_other,
          drain_surface, drain_surface_other,
          drain_blockage, drain_blockage_other,
          drain_water_flow, drain_outflow, drain_outlet_blockage,
          drain_type, drain_type_other,
          ditch_vegetation_present, ditch_erosion
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11, $12,
          $13, $14, $15, $16,
          $17, $18, $19, $20,
          $21, $22, $23, $24,
          $25, $26, $27, $28,
          $29, $30, $31, $32,
          $33, $34, $35, $36, $37
        )
        RETURNING id`,
        [
          data.reporter_name,
          data.report_type,
          parseFloat(data.latitude),
          parseFloat(data.longitude),
          data.culvert_type || null,
          data.culvert_diameter || null,
          data.water_flow || null,
          data.culvert_blockage || null,
          data.header_condition || null,
          data.inlet_condition || null,
          data.outlet_condition || null,
          data.ownership || null,
          data.additional_info || '',
          inletPhoto,
          outletPhoto,
          ditchPhoto,
          drainPhoto,
          data.timestamp,
          data.perched_status || null,
          data.road_condition || null,
          data.ditch_adjacent || null,
          data.ditch_adjacent_other || '',
          data.ditch_water || null,
          data.ditch_water_other || '',
          data.ditch_vegetation || null,
          data.ditch_vegetation_other || '',
          data.drain_surface || null,
          data.drain_surface_other || '',
          data.drain_blockage || null,
          data.drain_blockage_other || '',
          data.drain_water_flow || null,
          data.drain_outflow || null,
          data.drain_outlet_blockage || null,
          data.drain_type || null,
          data.drain_type_other || '',
          data.ditch_vegetation_present || null,
          data.ditch_erosion || null
        ]
      );

      const survey_id = result.rows[0].id;

      // Extract additional photos from req.files
      let additionalPhotos = req.files?.additional_photos;

      if (!additionalPhotos) {
        additionalPhotos = [];
      } else if (!Array.isArray(additionalPhotos)) {
        additionalPhotos = [additionalPhotos];
      }
      
      // Insert additional photos into survey_photos table
      if (additionalPhotos.length > 0) {
//        console.log(`📸 Preparing to batch insert ${additionalPhotos.length} additional photo(s)`);
      
        const placeholders = additionalPhotos
          .map((_, idx) => `($1, $${idx + 2})`) // $1 is survey_id, $2+ are images
          .join(', ');
      
        const insertPhotoQuery = `
          INSERT INTO survey_photos (survey_id, image)
          VALUES ${placeholders}
        `;
      
        const insertParams = [survey_id, ...additionalPhotos.map(file => file.buffer)];
      
        try {
          await pool.query(insertPhotoQuery, insertParams);
        //  console.log(`✅ Successfully inserted ${additionalPhotos.length} additional photo(s)`);
        } catch (e) {
          console.error(`❌ Batch insert failed for additional_photos:`, e.message);
        }
      }

    //  console.log('🧾 Received files:', Object.keys(req.files || {}));

      res.status(200).json({ success: true, message: 'Form saved successfully' });
    } catch (err) {
      console.error('❌ Insert error:', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

app.get('/api/ping', (req, res) => {
  res.status(200).send('pong');
});

if (process.env.NODE_ENV === 'production') {
  // Log every incoming request
  app.use((req, res, next) => {
    console.log(`📥 Incoming request: ${req.method} ${req.url}`);
    if (/^\/:/.test(req.url)) {
      console.warn(`🚫 Blocked malformed path: ${req.url}`);
      return res.status(400).send('Invalid route');
    }
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));

  // Handle all frontend routes
  app.get('*', (req, res, next) => {
    if (req.accepts('html')) {
      console.log(`↪️ Wildcard GET route hit for: ${req.originalUrl}`);
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
      next();
    }
  });
}

console.log('Registered Express Routes:');
if (app._router?.stack?.forEach) {
  app._router.stack.forEach((layer) => {
    if (layer.route?.path) {
      console.log('  →', layer.route.path);
    } else if (layer.name === 'router' && layer.handle?.stack) {
      layer.handle.stack.forEach((nested) => {
        console.log('  →', nested.route?.path);
      });
    }
  });
} else {
  console.warn('⚠️ No routes registered — app._router.stack is undefined.');
}


// Start Express server
try {
  app.listen(PORT, () => {
    console.log(`🚀 Server is running at PORT:${PORT}`);
  });
} catch (err) {
  console.error('❌ Server failed to start:', err);
}
