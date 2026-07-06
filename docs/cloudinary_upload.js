// Cloudinary Uploader for Doctors on Wheels
// Direct browser uploads using Cloudinary unsigned upload preset

const CLOUDINARY_CONFIG = {
    cloudName: window.CLOUDINARY_CLOUD_NAME || '',
    uploadPreset: window.CLOUDINARY_UPLOAD_PRESET || '',
};

async function uploadToCloudinary(data, role, email) {
    const { cloudName, uploadPreset } = CLOUDINARY_CONFIG;
    if (!cloudName || !uploadPreset) {
        throw new Error('Cloudinary not configured. Set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET.');
    }

    const formData = new FormData();
    formData.append('file', new Blob([JSON.stringify({
        ...data,
        submitted_at: new Date().toISOString(),
        source: 'github_pages_waitlist',
    })], { type: 'application/json' }), `${email.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`);
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', `waitlist/${role.toUpperCase()}`);

    const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`,
        { method: 'POST', body: formData }
    );

    if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.secure_url;
}

async function uploadImage(file, folder) {
    const { cloudName, uploadPreset } = CLOUDINARY_CONFIG;
    if (!cloudName || !uploadPreset) {
        throw new Error('Cloudinary not configured.');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', folder);

    const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        { method: 'POST', body: formData }
    );

    if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.secure_url;
}

window.CloudinaryUploader = { uploadToCloudinary, uploadImage };
