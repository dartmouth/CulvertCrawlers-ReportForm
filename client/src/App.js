
import './index.css';
import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { getImage, saveImage, saveImageOffline, deleteImage } from './utils/imageStore';
import { get } from 'idb-keyval';
import Select from 'react-select';
import InfoPopover from './utils/InfoPopover';


const isImageField = (key) =>
  ['inlet_photo', 'outlet_photo', 'ditch_photo', 'drain_photo', 'additional_photos'].includes(key);

const OFFLINE_SUBMISSIONS_KEY = 'offlineSurveyQueue';
const apiBase = window.location.origin.includes('localhost')
  ? 'http://localhost:5000'
  : window.location.origin;


function App() {
  
  useEffect(() => {
    document.title = 'Culvert Crawlers Community Science Report Form';
  }, []);
  
  const {
    register,
    unregister,
    handleSubmit,
    reset,
    setValue,
    getValues,
    watch,
    formState: { errors }
  } = useForm({ mode: 'onBlur' });

  const [email, setEmail] = useState('');
  const emailRef = useRef('');
  const updateEmail = (val) => {
    setEmail(val);
    emailRef.current = val;
  };

  useEffect(() => {
    if (email) {
      reset({
        reporter_name: email,
        timestamp: getCurrentTimestamp(),
      });
    }
  }, [email, reset]);

    
  useEffect(() => {
    const subscription = watch((value, { name }) => {
      if (name === 'reporter_name') {
        updateEmail(value.reporter_name || '');
      }
    });
    return () => subscription.unsubscribe();
  }, [watch]);


  const handleGeolocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }
  
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords.latitude.toFixed(8));
        const lon = Number(position.coords.longitude.toFixed(8));

        setValue('latitude', lat);
        setValue('longitude', lon);
      },
      (error) => {
        alert('Error getting location: ' + error.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };


  const getCurrentTimestamp = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const local = new Date(now.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
  };

  useEffect(() => {
    reset({ timestamp: getCurrentTimestamp() });
  }, [reset]);

  //Review form data prior to submission
  const [reviewData, setReviewData] = useState(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  
  const handleReview = () => {
    const values = getValues();
    setReviewData({
      ...values,
      photoCounts: {
        inlet: inletPhotoRef.current?.files?.length || 0,
        outlet: outletPhotoRef.current?.files?.length || 0,
        ditch: ditchPhotoRef.current?.files?.length || 0,
        drain: drainPhotoRef.current?.files?.length || 0,
        additional: additionalPhotosRef.current?.files?.length || 0
      }
    });
    setShowReviewModal(true);
  };


  function injectOfflineImages(submission) {
    const { fields, __images } = submission;
    const injected = { ...fields };
  
    if (__images) {
      for (const [key, imageId] of Object.entries(__images)) {
        injected[key] = imageId;
      }
    }
  
    return injected;
  }

  const handleOnline = useCallback(async () => {
    const submissions = JSON.parse(localStorage.getItem(OFFLINE_SUBMISSIONS_KEY) || '[]');
  
    if (submissions.length === 0) return;
  
    const backendAvailable = await waitForDNS();
  
    if (!backendAvailable) {
      alert('⚠️ Cannot resend queued submissions: server is still unreachable.');
      return;
    } 

    const stillQueued = [];
    for (const submission of submissions) {
      const data = injectOfflineImages(submission);
      const imageIds = Object.values(submission.__images || {});
    
      try {
        const success = await submitToServerOffline(data);
        if (!success) throw new Error('Server rejected submission.');
    
        // Delete all used image blobs
        for (const id of Array.isArray(imageIds) ? imageIds.flat() : [imageIds]) {
          await deleteImage(id);
        }
      } catch (err) {
        stillQueued.push(submission);  // fallback
      }
    } 
    if (stillQueued.length > 0) {
      localStorage.setItem(OFFLINE_SUBMISSIONS_KEY, JSON.stringify(stillQueued));
      alert(`${stillQueued.length} offline submission(s) will be sent without photoes.`);
      await handleSendQueuedData();
    } else {
      localStorage.removeItem(OFFLINE_SUBMISSIONS_KEY);
      alert('✅ All queued survey submissions were successfully sent!');
    }
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [handleOnline]); 

  const getOfflineCount = () => {
    const raw = localStorage.getItem(OFFLINE_SUBMISSIONS_KEY);
    const submissions = JSON.parse(raw || '[]');
    return submissions.length;
  };

  const pendingImagesRef = useRef({});
  
  const handleCapture = async (e, fieldName) => {
    const files = Array.from(e.target.files);
    if (!files.length) {
      console.warn(`⚠️ No file selected for field: ${fieldName}`);
      return;
    }
  
    // Define photo count limits for each report_type and additional_photos
    const limits = {
      inlet_photo: 1,
      outlet_photo: 1,
      ditch_photo: 1,
      drain_photo: 1,
      additional_photos: 5,
    };
  
    const isMulti = fieldName === 'additional_photos';
    const limit = limits[fieldName] || 1;
  
    // Validate file count
    if (files.length > limit) {
      alert(`You can only upload up to ${limit} file(s) for "${fieldName.replace('_', ' ')}".`);
      e.target.value = ''; // Clear file input
      return;
    }
  
    if (!navigator.onLine) {
      // console.log(`📴 Offline mode triggered for: ${fieldName}`);
      if (!pendingImagesRef.current[fieldName]) {
        pendingImagesRef.current[fieldName] = isMulti ? [] : null;
      }
  
      for (const file of files) {  
        if (!(file instanceof Blob)) {
          continue;
        }
  
        try {
          const imageId = await saveImage(file); // handles save and ID gen  
          if (isMulti) {
            pendingImagesRef.current[fieldName].push(imageId);
          } else {
            pendingImagesRef.current[fieldName] = imageId;
          }
        } catch (err) {
        //  console.error('Failed to save image to IndexedDB:', err);
        }
      }
    } else {
      // Online: set file(s) directly in RHF
      setValue(fieldName, isMulti ? files : files[0]);
    }
  };

  function storeOfflineWithImages(data) {
    const { __images, ...strippedData } = data;  
    // Remove binary/image fields that can't be stored in localStorage
    const cleanedFields = { ...strippedData };
    ['inlet_photo', 'outlet_photo', 'ditch_photo', 'drain_photo', 'additional_photos'].forEach(f => delete cleanedFields[f]);
  
    const submission = {
      fields: cleanedFields,
      __images: { ...pendingImagesRef.current }  // Store only image ID references
    };
  
    const queue = JSON.parse(localStorage.getItem(OFFLINE_SUBMISSIONS_KEY) || '[]');
    queue.push(submission);
    localStorage.setItem(OFFLINE_SUBMISSIONS_KEY, JSON.stringify(queue));
  
    // Cleanup
    pendingImagesRef.current = {};
    setSubmitted(true);
    reset();
  }

  const inletPhotoRef = useRef(null);
  const outletPhotoRef = useRef(null);
  const ditchPhotoRef = useRef(null);
  const drainPhotoRef = useRef(null);
  const additionalPhotosRef = useRef(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = async (data) => {
    setIsSubmitting(true); // disable the submit button
    try {
      const reporter = data.reporter_name;
      updateEmail(reporter);
  
      const cleanedData = { ...data };
      ['inlet_photo', 'outlet_photo', 'ditch_photo', 'drain_photo', 'additional_photos'].forEach(f => delete cleanedData[f]);
  
      if (navigator.onLine) {
        const success = await submitToServer(data);
  
        if (success) {
          alert('✅ Survey submitted online successfully!');
          setSubmitted(true);
  
          if (inletPhotoRef.current) inletPhotoRef.current.value = '';
          if (outletPhotoRef.current) outletPhotoRef.current.value = '';
          if (ditchPhotoRef.current) ditchPhotoRef.current.value = '';
          if (drainPhotoRef.current) drainPhotoRef.current.value = '';
          if (additionalPhotosRef.current) additionalPhotosRef.current.value = '';
        } else {
          storeOfflineWithImages(cleanedData);  // fallback if submitToServer fails
          const offlineCount = getOfflineCount();
          alert(`📴 Offline mode: Data saved locally! (${offlineCount} queued)`);
        }
      } else {
        storeOfflineWithImages(cleanedData);  // offline default
        const offlineCount = getOfflineCount();
        alert(`📴 Offline mode: Data saved locally. (${offlineCount} queued)`);
      }
  
      reset({
        reporter_name: emailRef.current,
        timestamp: getCurrentTimestamp(),
        additional_info: '',
        latitude: '',
        longitude: '',
        ditch_adjacent_other: '',
        ditch_water_other: '',
        ditch_vegetation_other: '',
        drain_surface_other: '',
        drain_blockage_other: '',
        drain_type_other: '',
      });
      
    } catch (error) {
      //console.error('Error during submission:', error);
      alert('waiting...');
    } finally {
      setIsSubmitting(false); // re-enable the button
    }
  };


  // Utility: Check if backend API is reachable
  const waitForDNS = async (url = `${apiBase}/api/ping`, maxTries = 5, delay = 3000) => {
    for (let tries = 0; tries < maxTries; tries++) {
      try {
        console.log(`🔍 Checking backend connectivity (${tries + 1}/${maxTries})...`);
        const res = await fetch(url, {
          method: 'GET',
          cache: 'no-store',       // avoid caching ping results
          mode: 'cors',            // ensure cross-origin errors are thrown
        });
  
        if (res.ok) {
        //  console.log('✅ Backend is reachable via /api/ping');
          return true;
        } else {
        //  console.warn(`⚠️ Ping responded with status ${res.status}. Retrying...`);
        }
      } catch (e) {
       // console.warn('⏳ DNS/backend unreachable, retrying in', delay / 1000, 'sec');
      }
  
      await new Promise(res => setTimeout(res, delay));
    }
  
   // console.error('❌ Backend/DNS still unreachable after', maxTries, 'tries');
    return false;  // more graceful than throwing
  };

  const handleSendQueuedData = async () => {
    try {
      const submissions = JSON.parse(localStorage.getItem(OFFLINE_SUBMISSIONS_KEY) || '[]');
  
      if (submissions.length === 0) {
        alert('No queued offline submissions!');
        return;
      }
  
      const backendAvailable = await waitForDNS();
  
      if (!backendAvailable) {
        console.warn('⛔ Backend still not reachable. Skipping resend.');
        alert('⚠️ Offline: please clear queued data when you are back online');
        return;
      }
  
      const stillQueued = [];
  
      for (const submission of submissions) {
        const imageIds = Object.values(submission.__images || {});
        try {
          // Deep clone and strip .__images
          const cleanedSubmission = JSON.parse(JSON.stringify(submission));
          delete cleanedSubmission.__images;
  
          const data = injectOfflineImages(cleanedSubmission); // rehydrate image IDs
          const success = await submitToServer(data);
          // Delete all used image blobs
          for (const id of Array.isArray(imageIds) ? imageIds.flat() : [imageIds]) {
            await deleteImage(id);
          }
          if (!success) throw new Error('Server rejected submission.');
        } catch (err) {
         //   console.error('❌ Failed to resend submission:', submission, err);
            stillQueued.push(submission); // preserve original with __images in case of retry
          }
      }
  
      if (stillQueued.length > 0) {
        localStorage.setItem(OFFLINE_SUBMISSIONS_KEY, JSON.stringify(stillQueued));
        alert(`${stillQueued.length} submission(s) failed to resend and remain stored locally.`);
      } else {
        localStorage.removeItem(OFFLINE_SUBMISSIONS_KEY);
        alert('✅ All queued survey submissions were successfully sent!');
      }
  
      reset({
        reporter_name: emailRef.current,
        timestamp: getCurrentTimestamp(),
      });
    } catch (err) {
    //  console.error('🚨 Fatal error in handleSendQueuedData():', err);
      alert('Offline submission failed. Contact admin for suggestions.');
    }
  };


  const submitToServerOffline = async (data) => {
    const formData = new FormData();  
    for (const key in data) {
      const value = data[key];
      // Skip internal offline image metadata
      if (key === "images" || key === "__images") continue;

      // Prevent undefined-value crash
      if (typeof value === 'undefined') {
      //  console.warn(`⚠️ Skipping key "${key}" because value is undefined`);
        continue;
      }
  
      // 1. Handle image ID string (offline blob key)
      if (typeof value === 'string' && isImageField(key)) {
        const blob = await get(value);  // where value is like "1750019864934-xyz"
        if (blob instanceof Blob && blob.size > 0) {
          formData.append(key, blob, `${key}.jpg`);
        } else {
        //  console.warn(`⚠️ No blob for ${key}: ${value}`);
        }
        continue;
      } 
      // 2. Handle array of image IDs (e.g., additional_photos)
      if (Array.isArray(value) && isImageField(key)) {
        for (const imageId of value) {
          const blob = await get(imageId);
      //   console.log('🔍 get()', imageId, '→', blob instanceof Blob, blob?.size);
          if (blob instanceof Blob && blob.size > 0) {
            formData.append(key, blob, `${key}-${Date.now()}.jpg`);
          } else {
       //     console.warn(`⚠️ Failed to get blob for additional photo:`, imageId);
          }
        }
        continue;
      }
 
      // 3. File objects (online use case)
      if (value instanceof FileList) {
        Array.from(value).forEach(file => formData.append(key, file));
      } else if (value instanceof File) {
        formData.append(key, value);
      } else if (Array.isArray(value)) {
        value.forEach(item => {
          if (item instanceof File) {
            formData.append(key, item);
          }
        });
      } else {
        formData.append(key, value);
      }
    }
  
    try {
      const response = await fetch(`${apiBase}/api/submit`, {
        method: 'POST',
        body: formData,
      });
  
      if (!response.ok) {
        const text = await response.text();
        console.error('Server returned error:', response.status, text);
        return false;
      }
  
      return true;
    } catch (error) {
      console.error('Fetch error:', error);
      return false;
    }
  };

  const submitToServer = async (data) => {
    const formData = new FormData();
  
   for (const key in data) {
     const value = data[key];
   
     if (value instanceof FileList) {
       Array.from(value).forEach(file => {
         formData.append(key, file, file.name || `${key}-${Date.now()}.jpg`);
       });
     } else if (value instanceof File) {
       formData.append(key, value, value.name || `${key}-${Date.now()}.jpg`);
     } else if (Array.isArray(value)) {
       value.forEach(file => {
         if (file instanceof File) {
           formData.append(key, file, file.name || `${key}-${Date.now()}.jpg`);
         }
       });
     } else {
       formData.append(key, value);
     }
   }
 
    try {
    //  for (const [key, val] of formData.entries()) {
   //     console.log('📤 FormData entry:', key, val.name || val);
   //   }
      const response = await fetch(`${apiBase}/api/submit`, {
        method: 'POST',
        body: formData,
      });
  
      if (!response.ok) {
       // const text = await response.text(); // helpful to log
   //     console.error('Server returned error response:', response.status, text);
        return false;
      }
  
      return true;
    } catch (error) {
   //   console.error('Fetch error:', error);
      return false;
    }
  };

  const [history, setHistory] = useState([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const handleHistoryFetch = async () => {
    const reporterName = getValues('reporter_name');
  
    if (!reporterName || reporterName.trim() === '') {
      alert('Please enter your email to retrieve history.');
      return;
    }
  
    if (!navigator.onLine) {
      alert('Offline. Please retrieve submission history when back online.');
      return;
    }
  
    try {
      const response = await fetch(`${apiBase}/api/history?reporter_name=${encodeURIComponent(reporterName)}`);
      if (!response.ok) {
      //  const text = await response.text();
     //   console.error('Server returned:', text);
        alert('Error fetching history.');
        return;
      }
  
      const history = await response.json();
      setHistory(history);
      
      // Show the history modal popup
      if (history.length > 0) {
        setShowHistoryModal(true); // make sure this state exists
      } else {
        alert('No submission history found for this email.');
      }
  
    } catch (err) {
  //    console.error('Fetch error:', err);
      alert('Offline mode, please retrieve submission history when you are back online.');
    }
  };

//to be deleted if ditch question is reset
const [menuOpen, setMenuOpen] = useState(true); //used for ditch vegetation, to be deleted if ditch question is reset
const vegetationOptions = [
  { value: "Short, low-lying and/or well-mown plants", label: "Short, low-lying and/or well-mown plants" },
  { value: "Taller plants, bushier shrubs", label: "Taller plants, bushier shrubs" },
  { value: "Small trees and undergrowth", label: "Small trees and undergrowth" },
];
const noVegetationOptions = [
  { value: "No, bare dirt", label: "Bare dirt" },
  { value: "No, heavy stone/riprap", label: "Heavy stone / riprap" },
  { value: "No, other", label: "Other (add details)" },
];
//to be deleted

const ditchAdjacent = watch('ditch_adjacent');
const reportType = watch('report_type');
useEffect(() => {
    if (reportType === 'Culvert') {
      register('ownership', { required: 'Ownership selection is required' });
    } else {
      unregister('ownership');
    }
}, [reportType, register, unregister]);

return (
  <div className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center">
    <div className="max-w-lg w-full mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-4 text-center">
        Culvert Crawlers Community Science Survey Form (offline enabled)
      </h1>
      <h2 className="text-center mb-6 text-sm text-gray-600">
        <a
          href="https://culvertcrawlers-communitysciencemap.dartmouth.edu/mapwithsurveyphotos"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-medium"
        >
          Culvert Crawlers Community Science Map
        </a>{" "}
        and Survey are a collaborative effort of the Rural Rivers Project and the Energy Justice Clinic at Dartmouth, 
        Dartmouth Research Computing, the Black River Action Team, Cavendish Connects, and the Hartford Energy Commission.
      </h2>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 text-base">
      {/* Login Info */}
      <h2 className="text-lg font-semibold">Reporter Email</h2>
      <input
        className="border rounded px-3 py-2"
        placeholder="Your Email *"
        {...register('reporter_name', {
          required: 'Email is required',
          pattern: {
            value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            message: 'Enter a valid email address'
          }
        })}
      />
      {errors.reporter_name && <p className="text-red-600 text-sm">{errors.reporter_name.message}</p>}
    
      {/* Location */}
      <h2 className="flex items-baseline gap-1">
        <span className="text-lg font-semibold">Location</span>
        <span className="text-sm text-gray-600">(On iPhone, for best results, use Firefox. You may need to enable geolocation permission in Setttings when using Safari.)</span>
      </h2>
      <button
        type="button"
        onClick={handleGeolocation}
        className="mb-2 text-sm text-blue-600 underline"
      >
        📍 Use My Location
      </button>

      <input
        className="border rounded px-3 py-2 mb-1 w-full"
        type="number"
        step="0.00000001"
        placeholder="Latitude *"
        {...register('latitude', {
          required: 'Latitude is required',
          min: { value: -90, message: 'Minimum latitude is -90' },
          max: { value: 90, message: 'Maximum latitude is 90' },
        })}
      />
      {errors.latitude && (
        <p className="text-red-600 text-sm mb-2">{errors.latitude.message}</p>
      )}

      <input
        className="border rounded px-3 py-2 mb-1 w-full"
        type="number"
        step="0.00000001"
        placeholder="Longitude *"
        {...register('longitude', {
          required: 'Longitude is required',
          min: { value: -180, message: 'Minimum longitude is -180' },
          max: { value: 180, message: 'Maximum longitude is 180' },
        })}
      />
      {errors.longitude && (
        <p className="text-red-600 text-sm mb-2">{errors.longitude.message}</p>
      )}

      {/* Report Details */}
      <h2 className="text-lg font-semibold">Report Details</h2>
      <select
        className={`border rounded px-3 py-2 w-full ${
          errors.report_type ? 'border-red-500' : 'border-gray-300'
        }`}
        {...register('report_type', { required: 'Report type is required' })}
      >
        <option value="">-- Select Report Type * --</option>
        <option value="Culvert">Culvert</option>
        <option value="Ditch">Ditch</option>
        <option value="Storm Drain">Storm Drain</option>
      </select>
      {errors.report_type && (
        <p className="text-red-600 text-sm mt-1">{errors.report_type.message}</p>
      )}

      {/* Culvert */}
      {reportType === 'Culvert' && ( 
        <>
         <select className="border rounded px-3 py-2" {...register('culvert_type')}>
           <option value="">-- Select Culvert Type --</option>
           <option value="Plastic pipe">Plastic pipe</option>
           <option value="Metal pipe">Metal pipe</option>
           <option value="Concrete">Concrete</option>
           <option value="Masonry">Masonry</option>
         </select>
       
         <select className="border rounded px-3 py-2" {...register('culvert_diameter')}>
           <option value="">-- Select Diameter --</option>
           <option value="<8">&lt;8" (20 cm)</option>
           <option value="8-16">8-16" (20–41 cm)</option>
           <option value="16-32">16-32" (41–81 cm)</option>
           <option value="32-48">32-48" (81–122 cm)</option>
           <option value=">48">&gt;48" (122 cm)</option>
         </select>
       
         <select className="border rounded px-3 py-2" {...register('water_flow')}>
           <option value="">-- Select Water Flow --</option>
           <option value="Dry">Dry</option>
           <option value="Trickle">Small trickle</option>
           <option value="Moderate">Moderate flow</option>
           <option value="Significant">Significant flow</option>
         </select>
       
         <select className="border rounded px-3 py-2" {...register('culvert_blockage')}>
           <option value="">-- Select Blockage --</option>
           <option value="No blockage">No blockage</option>
           <option value="<25% blocked">&lt;25% blocked</option>
           <option value="25-50% blocked">25-50% blocked</option>
           <option value=">50% blocked">&gt;50% blocked</option>
         </select>
         
         <label htmlFor="perched_status" className="flex items-center justify-between mb-1">
           <span className="font-medium">Perched status</span>
           <InfoPopover title="Perched status">
             When a culvert is “perched,” one or both ends of the tube do not lie flat against the ground. 
             A culvert with a “perched” outlet makes it hard for fish and other water animals to swim upstream, 
             because of the small waterfall it makes. A culvert with a “perched” inlet doesn’t do its job, 
             because the water can’t get into the culvert.
           </InfoPopover>
         </label>

         <select className="border rounded px-3 py-2 mb-4" {...register('perched_status')}>
           <option value="">-- Select Perched Status --</option>
           <option value="No, inlet and outlet are on same level as streambed">
             No, inlet and outlet are on same level as streambed
           </option>
           <option value="Partially, inlet is higher than streambed">
             Partially, inlet is higher than streambed
           </option>
           <option value="Partially, outlet is higher than streambed">
             Partially, outlet is higher than streambed
           </option>
           <option value="Yes, both inlet and outlet are higher than streambed">
             Yes, both inlet and outlet are higher than streambed
           </option>
         </select>
       </>
      )}

      {/* Ditch */}
      {reportType === 'Ditch' && (
        <>
         <select className="border rounded px-3 py-2 mb-4" {...register('ditch_adjacent')}>
           <option value="">-- Is ditch adjacent to culvert? --</option>
           <option value="No">No</option>
           <option value="Inlet (feeds into culvert, upstream)">
             Yes – Feeds into the inlet of the culvert (upstream)
           </option>
           <option value="Outlet (drains from culvert, downstream)">
             Yes – Drains the outlet of the culvert (downstream)
           </option>
           <option value="Other">Yes – Other (add details)</option>
         </select>
   
         {ditchAdjacent === 'Other' && (
           <div className="mb-4">
             <label className="block mb-2 font-medium">
               Please describe how this ditch relates to the culvert:
             </label>
             <textarea
               className="border rounded px-3 py-2 w-full"
               rows={2}
               placeholder="Provide additional details..."
               {...register('ditch_adjacent_other')}
             />
           </div>
         )}

         <select className="border rounded px-3 py-2 mb-4" {...register('ditch_erosion')}>
          <option value="">-- Is there erosion in and around the ditch? --</option>
          <option value="Significant">Significant</option>
          <option value="Some">Some</option>
          <option value="A little">A little</option>
          <option value="None">None</option>
        </select>

         <select className="border rounded px-3 py-2 mb-4" {...register('ditch_water')}>
           <option value="">-- Is there water in the ditch? --</option>
           <option value="No, dry">No, dry</option>
           <option value="Standing water">Standing water</option>
           <option value="Slow trickle">Slow trickle</option>
           <option value="Moderate flow">Moderate flow</option>
           <option value="Significant flow">Significant flow</option>
           <option value="Other">Other (add details)</option>
         </select>
         
         {watch('ditch_water') === 'Other' && (
           <div className="mb-4">
             <label className="block mb-2 font-medium">Please describe the water condition:</label>
             <textarea
               className="border rounded px-3 py-2 w-full"
               rows={2}
               placeholder="Describe the ditch water flow or condition..."
               {...register('ditch_water_other')}
             />
           </div>
         )}
   
         {/* ditch vegetation */}
         <select className="border rounded px-3 py-2 mb-4" {...register('ditch_vegetation_present')}>
           <option value="">-- Does the ditch have vegetation in it? --</option>
           <option value="Short, low-lying and/or well-mown plants">Short, low-lying and/or well-mown plants</option>
           <option value="Taller plants, bushier shrubs">Taller plants, bushier shrubs</option>
           <option value="Small trees and undergrowth">Small trees and undergrowth</option>
           <option value="No, bare dirt">No, bare dirt</option>
           <option value="No, heavy stone/riprap">No, heavy stone/riprap</option>
           <option value="No, other (add details)">No, other (add details)</option>
         </select>

         {watch('ditch_vegetation_present') === 'No, other (add details)' && (
               <div className="mb-4">

                 <textarea
                   className="border rounded px-3 py-2 w-full"
                   rows={2}
                   placeholder="No vegetation, describe the ditch surface ..."
                   {...register('ditch_vegetation_other')}
                 />
               </div>
          )}
         
         {/* Step 2a: Show vegetation types if "Yes" - to be deleted */}
         {watch('ditch_vegetation_present') === 'Yes' && (
           <>
             <label className="block mb-2 font-medium">What kind of vegetation?</label>
             <Select
               options={vegetationOptions}
               onChange={(selected) => {
                 setValue('ditch_vegetation', selected.value);
                 setMenuOpen(false); // close dropdown after selection
               }}
               value={vegetationOptions.find(opt => opt.value === watch('ditch_vegetation')) || null}
               menuIsOpen={menuOpen}
               onMenuOpen={() => setMenuOpen(true)} // allow re-opening on click
             />
           </>
         )}
         
         {/* Step 2b: Show surface types if "No" - to be deleted */}
         {watch('ditch_vegetation_present') === 'No' && (
           <>
             <label className="block mb-2 font-medium">What is in the ditch?</label>
             <Select
               options={noVegetationOptions}
               onChange={(selected) => {
                 setValue('ditch_vegetation', selected.value);
                 setMenuOpen(false); // close dropdown after selecting
               }}
               value={noVegetationOptions.find(opt => opt.value === watch('ditch_vegetation')) || null}
               menuIsOpen={menuOpen}
               onMenuOpen={() => setMenuOpen(true)} // allow re-opening if clicked
               className="mb-4"
             />        
           </>
         )}
       </>
      )}

      {/* Drain */}
      {reportType === 'Storm Drain' && (
        <>
         <select className="border rounded px-3 py-2 mb-4" {...register('drain_surface')}>
           <option value="">-- Select Drain Surface Type --</option>
           <option value="Dirt/gravel road">Dirt/gravel road</option>
           <option value="Paved road">Paved road</option>
           <option value="Parking lot">Parking lot</option>
           <option value="Sidewalk">Sidewalk</option>
           <option value="Other">Other (add details)</option>
         </select>
         
         {watch('drain_surface') === 'Other' && (
           <div className="mb-4">
             <label className="block mb-2 font-medium">Please describe the surface type:</label>
             <textarea
               className="border rounded px-3 py-2 w-full"
               rows={2}
               placeholder="Describe the surface where the drain is located..."
               {...register('drain_surface_other')}
             />
           </div>
         )}
   
         <select className="border rounded px-3 py-2 mb-4" {...register('drain_type')}>
           <option value="">-- Select Drain Type --</option>
           <option value="Solid metal grate">Solid metal grate</option>
           <option value="Bars">Bars</option>
           <option value="Other">Other (add details)</option>
         </select>
         
         {watch('drain_type') === 'Other' && (
           <div className="mb-4">
             <label className="block mb-2 font-medium">Please describe the drain type:</label>
             <textarea
               className="border rounded px-3 py-2 w-full"
               rows={1}
               placeholder="Describe the type of drain..."
               {...register('drain_type_other')}
             />
           </div>
         )}
       
         <select className="border rounded px-3 py-2 mb-4" {...register('drain_water_flow')}>
           <option value="">-- Is water flowing into the drain? --</option>
           <option value="Dry">Dry</option>
           <option value="Trickle">Small trickle</option>
           <option value="Moderate">Moderate flow</option>
           <option value="Significant">Significant flow</option>
           <option value="Standing water over drain (not draining)">
             Water is standing still over the drain / not draining
           </option>
         </select>
   
         {/* Is water flowing out of the drain? */}
         <select className="border rounded px-3 py-2 mb-4" {...register('drain_outflow')}>
           <option value="">-- Is water flowing out of the drain outlet? --</option>
           <option value="Yes">Yes</option>
           <option value="No">No</option>
           <option value="Cannot locate outlet">Cannot locate outlet</option>
         </select>
   
         {/* Show outlet blockage question if 'Yes' or 'No' is selected */}
         {['Yes', 'No'].includes(watch('drain_outflow')) && (
           <>
             <label className="block mb-2 font-medium">Is the outlet blocked?</label>
             <select className="border rounded px-3 py-2 mb-4" {...register('drain_outlet_blockage')}>
               <option value="">-- Select Outlet Blockage --</option>
               <option value="No blockage">No blockage</option>
               <option value="<25% blocked">&lt; 25% blocked</option>
               <option value="25-50% blocked">25–50% blocked</option>
               <option value=">50% blocked">&gt; 50% blocked</option>
             </select>
           </>
         )}
   
         <select className="border rounded px-3 py-2 mb-4" {...register('drain_blockage')}>
           <option value="">-- Is the drain inlet blocked? --</option>
           <option value="No">No</option>
           <option value="Light debris (sticks, grass, can be pushed aside)">
             Light debris (sticks, grass, can be pushed aside)
           </option>
           <option value="Medium debris (sticks and grass in mud/dirt/sand, harder to push aside)">
             Medium debris (sticks and grass in mud/dirt/sand, harder to push aside)
           </option>
           <option value="Heavy debris (piles that impede flow and must be moved with machinery)">
             Heavy debris (piles that impede flow and must be moved with machinery)
           </option>
           <option value="Other">Other (add details)</option>
         </select>
         
         {watch('drain_blockage') === 'Other' && (
           <div className="mb-4">
             <label className="block mb-2 font-medium">Describe the type of blockage:</label>
             <textarea
               className="border rounded px-3 py-2 w-full"
               rows={1}
               placeholder="Provide details about the blockage..."
               {...register('drain_blockage_other')}
             />
           </div>
         )}
       </>
      )}


      {/* Conditions */}
      {reportType === 'Culvert' && (
        <>
          <h5 className="text-base font-semibold">Conditions</h5>
           <label htmlFor="header" className="flex items-center justify-between mb-1">
            <span className="font-medium">Header</span>
            <InfoPopover title="Header">
               This is the area right above the opening of the culvert itself, usually buried in surrounding dirt. Sometimes this is a “header stone,” a piece of stone that acts as a “cap” for the culvert, and sometimes it’s something else, or nothing.
            </InfoPopover>
          </label>
          <select className="border rounded px-3 py-2" {...register('header_condition')}>
            <option value="">-- Select Header Condition --</option>
            <option value="Good">Good</option>
            <option value="Fair">Fair</option>
            <option value="Poor">Poor</option>
            <option value="None">No header</option>
            <option value="Unknown">Unknown</option>
          </select>
      
          <label htmlFor="inlet" className="flex items-center justify-between mb-1">
            <span className="font-medium">Inlet</span>
            <InfoPopover title="Inlet">
              The place where the water flows IN to the culvert (or would flow in, if there was water). Usually the uphill side of the tube.
            </InfoPopover>
          </label>
          <select className="border rounded px-3 py-2" {...register('inlet_condition')}>
            <option value="">-- Select Inlet Condition --</option>
            <option value="Good">Good</option>
            <option value="Fair">Fair</option>
            <option value="Poor">Poor</option>
            <option value="Unknown">Unknown</option>
          </select>
          
          <label htmlFor="outlet" className="flex items-center justify-between mb-1">
            <span className="font-medium">Outlet</span>
            <InfoPopover title="Outlet">
              The place where the water flows OUT of the culvert (or would flow out, if there was water). Usually the downhill side of the tube.
            </InfoPopover>
          </label>
          <select className="border rounded px-3 py-2" {...register('outlet_condition')}>
            <option value="">-- Select Outlet Condition --</option>
            <option value="Good">Good</option>
            <option value="Fair">Fair</option>
            <option value="Poor">Poor</option>
            <option value="Unknown">Unknown</option>
          </select>
        </>
      )}
      
      {(reportType === 'Culvert' || reportType === 'Ditch') && (
        <>
          <h5 className="text-base font-semibold mt-4">Road Condition</h5>
          <select className="border rounded px-3 py-2 mb-4" {...register('road_condition')}>
            <option value="">-- Select Road Condition --</option>
            <option value="Asphalt or other hard surface – Good condition – Smooth, well-maintained, no major defects">
              Asphalt or other hard surface – Smooth, well-maintained, no major defects
            </option>
            <option value="Asphalt or other hard surface – Fair condition – Minor surface wear, cracking, or weathering, but generally functional">
              Asphalt or other hard surface – Minor surface wear, cracking, or weathering, but generally functional
            </option>
            <option value="Asphalt or other hard surface – Poor condition – Significant damage, potholes, erosion, or potential safety concerns">
              Asphalt or other hard surface – Significant damage, potholes, erosion, or potential safety concerns
            </option>
            <option value="dirt or gravel road – even surface, well maintained">
              Dirt or gravel road – even surface, well maintained
            </option>
            <option value="dirt or gravel road – some erosion, still passable by all vehicles">
              Dirt or gravel road – some erosion, still passable by all vehicles
            </option>
            <option value="dirt or gravel road – major erosion, in need of repair">
              Dirt or gravel road – major erosion, in need of repair
            </option>
            <option value="Unknown">Unknown</option>
            <option value="not a public road">Not a public road</option>
          </select>
        </>
      )}

      {/* Photos */}
      <h2 className="text-lg font-semibold mt-4">Photos</h2>
      {(reportType === 'Culvert') && (
        <>
         {/* Inlet Photo */}
         <div className="mb-4">
         <label className="block text-sm font-medium mb-1">
           Inlet Photo <span className="text-gray-500 text-xs">(1 photo max)</span>
         </label>
           <input
             type="file"
             accept="image/*"
           //  capture="environment"
             ref={inletPhotoRef}
             className="border rounded px-3 py-2 w-full"
             onChange={(e) => handleCapture(e, 'inlet_photo')}
           />
         </div>
         
         {/* Outlet Photo */}
         <div className="mb-4">
           <label className="block text-sm font-medium mb-1">Outlet Photo <span className="text-gray-500 text-xs">(1 photo max)</span></label>
           <input
             type="file"
             accept="image/*"
             ref={outletPhotoRef}
           //  capture="environment"
             className="border rounded px-3 py-2 w-full"
             onChange={(e) => handleCapture(e, 'outlet_photo')}
           />
         </div>
       </>
      )}

      {/* Ditch Photo */}
      {reportType === 'Ditch' && (
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Ditch Photo <span className="text-gray-500 text-xs">(1 photo max)</span></label>
          <input
            type="file"
            accept="image/*"
          //  capture="environment"
            ref={ditchPhotoRef}
            className="border rounded px-3 py-2 w-full"
            onChange={(e) => handleCapture(e, 'ditch_photo')}
          />
        </div>
      )}
      
      {/* Drain Photo */}
      {reportType === 'Storm Drain' && (
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Drain Photo <span className="text-gray-500 text-xs">(1 photo max)</span></label>
          <input
            type="file"
            accept="image/*"
            ref={drainPhotoRef}
          //  capture="environment"
            className="border rounded px-3 py-2 w-full"
            onChange={(e) => handleCapture(e, 'drain_photo')}
          />
        </div>
      )}
      
      {/* Additional Photos */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">
         Additional Photos <span className="text-gray-500 text-xs">(up to 5 photos)</span>
        </label>
        <input
          type="file"
          accept="image/*"
          multiple
          ref={additionalPhotosRef}
        //  capture="environment"
          className="border rounded px-3 py-2 w-full"
          onChange={(e) => handleCapture(e, 'additional_photos')}
        />
      </div>

      {/* Property */}
      {reportType === 'Culvert' && (
        <>
         <h2 className="text-lg font-semibold">Property and Notes</h2>
         <select
           className={`border rounded px-3 py-2 w-full ${
             errors.ownership ? 'border-red-500' : 'border-gray-300'
           }`}
           {...register('ownership', { required: 'Ownership selection is required' })}
         >
           <option value="">-- Select Ownership * --</option>
           <option value="Public">Public</option>
           <option value="Private">Private</option>
           <option value="Border">Bordering public/private</option>
           <option value="Unknown">Unknown</option>
         </select>
         {errors.ownership && (
           <p className="text-red-600 text-sm mt-1">{errors.ownership.message}</p>
         )}
       </>
      )}

      <h2 className="text-lg font-semibold">Additional Info</h2>
      <textarea
        className="border rounded px-3 py-2"
        placeholder="Additional info..."
        {...register('additional_info')}
      />
    
      <input
        className="border rounded px-3 py-2"
        type="datetime-local"
        {...register('timestamp')}
        required
      />
    <h2 className="text-center mb-6 text-sm text-gray-600">
        Your submission will be stored locally while offline <br></br>
        Your locally-saved data will be sent to server once you're back online.
    </h2>
    <button
     type="button"
     className="bg-yellow-600 text-white px-4 py-2 rounded shadow"
     onClick={handleReview}
   >
     🧐 Review Before Submit
   </button>

    <button
      type="submit"
      className={`bg-blue-600 text-white px-4 py-2 rounded shadow transition-opacity ${
        isSubmitting ? 'opacity-50 cursor-not-allowed' : ''
      }`}
      disabled={isSubmitting}
    >
      {isSubmitting ? 'Submitting…' : 'Submit Report'}
    </button>

      <button
        type="button"
        className="mt-4 bg-gray-700 text-white px-4 py-2 rounded"
        onClick={handleHistoryFetch}
      >
      📄 Retrieve Submission History
      </button>
    </form>
    {submitted && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-30 z-50">
          <div className="bg-white border border-green-600 shadow-lg p-6 rounded-lg max-w-sm mx-auto relative">
            <button
              onClick={() => setSubmitted(false)}
              className="absolute top-2 right-2 text-gray-500 hover:text-black"
            >
              ✕
            </button>
            <p className="text-green-600 text-center mt-2">
              Your submission has been recorded successfully,<br />
              you can start another survey!
            </p>
          </div>
        </div>
    )}
    {/* Modal for Preview table */}
    {showReviewModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
        <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full p-6 overflow-y-auto max-h-[90vh]">
          <h2 className="text-xl font-bold mb-4">Review Your Report</h2>
    
          <div className="space-y-2 text-sm">
            <p><strong>Email:</strong> {reviewData.reporter_name}</p>
            <p><strong>Latitude:</strong> {reviewData.latitude}</p>
            <p><strong>Longitude:</strong> {reviewData.longitude}</p>
            <p><strong>Report Type:</strong> {reviewData.report_type}</p>
    
            {/* Culvert Fields */}
            {reviewData.report_type === 'Culvert' && (
              <>
                <p><strong>Culvert Type:</strong> {reviewData.culvert_type}</p>
                <p><strong>Diameter:</strong> {reviewData.culvert_diameter}</p>
                <p><strong>Water Flow:</strong> {reviewData.water_flow}</p>
                <p><strong>Blockage:</strong> {reviewData.culvert_blockage}</p>
                <p><strong>Perched Status:</strong> {reviewData.perched_status}</p>
                <p><strong>Header Condition:</strong> {reviewData.header_condition}</p>
                <p><strong>Inlet Condition:</strong> {reviewData.inlet_condition}</p>
                <p><strong>Outlet Condition:</strong> {reviewData.outlet_condition}</p>
                <p><strong>Road Condition:</strong> {reviewData.road_condition}</p>
                <p><strong>Ownership:</strong> {reviewData.ownership}</p>
              </>
            )}
    
            {/* Ditch Fields */}
            {reviewData.report_type === 'Ditch' && (
              <>
                <p><strong>Adjacent to Culvert:</strong> {reviewData.ditch_adjacent}</p>
                {reviewData.ditch_adjacent === 'Other' && (
                  <p><strong>Adjacency Details:</strong> {reviewData.ditch_adjacent_other}</p>
                )}
                <p><strong>Water Condition:</strong> {reviewData.ditch_water}</p>
                {reviewData.ditch_water === 'Other' && (
                  <p><strong>Water Details:</strong> {reviewData.ditch_water_other}</p>
                )}
                <p><strong>Vegetation Present:</strong> {reviewData.ditch_vegetation_present}</p>
                {reviewData.ditch_vegetation_other && (
                  <p><strong>Vegetation Other:</strong> {reviewData.ditch_vegetation_other}</p>
                )}
              </>
            )}
    
            {/* Storm Drain Fields */}
            {reviewData.report_type === 'Storm Drain' && (
              <>
                <p><strong>Surface Type:</strong> {reviewData.drain_surface}</p>
                {reviewData.drain_surface === 'Other' && (
                  <p><strong>Surface Details:</strong> {reviewData.drain_surface_other}</p>
                )}
                <p><strong>Drain Type:</strong> {reviewData.drain_type}</p>
                {reviewData.drain_type === 'Other' && (
                  <p><strong>Drain Type Details:</strong> {reviewData.drain_type_other}</p>
                )}
                <p><strong>Water Flow:</strong> {reviewData.drain_water_flow}</p>
                <p><strong>Drain Outflow:</strong> {reviewData.drain_outflow}</p>
                {['Yes', 'No'].includes(reviewData.drain_outflow) && (
                  <p><strong>Outlet Blockage:</strong> {reviewData.drain_outlet_blockage}</p>
                )}
                <p><strong>Inlet Blockage:</strong> {reviewData.drain_blockage}</p>
                {reviewData.drain_blockage === 'Other' && (
                  <p><strong>Blockage Details:</strong> {reviewData.drain_blockage_other}</p>
                )}
              </>
            )}
    
            <p><strong>Additional Info:</strong> {reviewData.additional_info || 'N/A'}</p>
            <p><strong>Timestamp:</strong> {reviewData.timestamp}</p>
    
            <p className="font-semibold mt-3">Photos Uploaded:</p>
            <ul className="list-disc list-inside ml-4">
              {reviewData.photoCounts.inlet > 0 && <li>Inlet Photo: {reviewData.photoCounts.inlet}</li>}
              {reviewData.photoCounts.outlet > 0 && <li>Outlet Photo: {reviewData.photoCounts.outlet}</li>}
              {reviewData.photoCounts.ditch > 0 && <li>Ditch Photo: {reviewData.photoCounts.ditch}</li>}
              {reviewData.photoCounts.drain > 0 && <li>Drain Photo: {reviewData.photoCounts.drain}</li>}
              {reviewData.photoCounts.additional > 0 && <li>Additional Photos: {reviewData.photoCounts.additional}</li>}
            </ul>
          </div>
    
          <div className="flex justify-end mt-6 gap-2">
            <button
              onClick={() => setShowReviewModal(false)}
              className="px-4 py-2 bg-gray-500 text-white rounded"
            >
              Close
            </button>

          </div>
        </div>
      </div>
    )}

     {/* Modal for history table */}
      {showHistoryModal && history.length > 0 && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
          <div className="bg-white border border-gray-300 shadow-lg rounded-lg p-6 w-full max-w-4xl max-h-[80vh] overflow-auto relative">
            <button
              onClick={() => setShowHistoryModal(false)}
              className="absolute top-3 right-3 text-gray-500 hover:text-black text-lg"
            >
              ✕
            </button>
            <h2 className="text-xl font-semibold mb-4 text-center">📄 Submission History</h2>
            <table className="w-full border-collapse text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border px-2 py-1">ID</th>
                  <th className="border px-2 py-1">Type</th>
                  <th className="border px-2 py-1">Lat</th>
                  <th className="border px-2 py-1">Long</th>
                  <th className="border px-2 py-1">Owner</th>
                  <th className="border px-2 py-1">Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td className="border px-2 py-1">{item.id}</td>
                    <td className="border px-2 py-1">{item.report_type}</td>
                    <td className="border px-2 py-1">{item.latitude}</td>
                    <td className="border px-2 py-1">{item.longitude}</td>
                    <td className="border px-2 py-1">{item.ownership}</td>
                    <td className="border px-2 py-1">{new Date(item.timestamp).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
   </div>
  );
}
export default App;

