// Doctors on Wheels Configuration - v2.0.0 (Serverless Supabase Adapter)
window.API_BASE = window.location.origin;

// Cloudinary
window.CLOUDINARY_CLOUD_NAME = 'hyucorgl';
window.CLOUDINARY_UPLOAD_PRESET = 'doctorlink';

// Supabase Configuration
window.SUPABASE_URL = 'https://jvsfhrekkkhijneqngax.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2c2ZocmVra2toaWpuZXFuZ2F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MDE4MTksImV4cCI6MjA5MTQ3NzgxOX0.NZw_9YAzHrXaW3Fg2DWaVyVP3eut-skqaxIgga0cU3s';

// Direct Client-Side Supabase API Emulator
(function() {
    let supabaseClient = null;

    // Load Supabase script dynamically if not present
    async function ensureSupabaseLoaded() {
        if (window.supabase) {
            if (!supabaseClient) {
                supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
            }
            return supabaseClient;
        }
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
            script.onload = () => {
                supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
                console.log('Supabase client-side adapter initialized.');
                resolve(supabaseClient);
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Capture standard API endpoints and emulate them using client-side Supabase
    const originalFetch = window.fetch;
    window.fetch = async function(resource, init) {
        const url = typeof resource === 'string' ? resource : resource.url;
        if (url.includes('/api/')) {
            const supabase = await ensureSupabaseLoaded();
            return await emulateApiCall(supabase, url, init);
        }
        return originalFetch(resource, init);
    };

    async function emulateApiCall(supabase, url, init) {
        const urlObj = new URL(url, window.location.origin);
        const path = urlObj.pathname;
        const method = (init && init.method || 'GET').toUpperCase();
        
        try {
            // --- AUTHENTICATION ---
            if (path === '/api/auth/register' && method === 'POST') {
                const body = JSON.parse(init.body);
                const email = body.email;
                const name = body.name;
                const role = (body.role || 'PATIENT').toUpperCase();

                // Check if profile already exists in Profiles database table
                let { data: existingProfile } = await supabase
                    .from('Profiles')
                    .select('*')
                    .eq('email', email)
                    .single();

                if (existingProfile) {
                    throw new Error('Email is already registered');
                }

                // Query max ID to avoid sequence desynchronization duplicate key violations
                let { data: maxIdData } = await supabase.from('Profiles').select('id').order('id', { ascending: false }).limit(1);
                const nextId = (maxIdData && maxIdData.length > 0) ? (Number(maxIdData[0].id) + 1) : 1;

                // Create profile record in Supabase Database (bypassing GoTrue Auth rate limits)
                const { data: profile, error: pError } = await supabase
                    .from('Profiles')
                    .insert({
                        id: nextId,
                        email: email,
                        name: name,
                        role: role,
                        credits: 0
                    })
                    .select()
                    .single();
                if (pError) {
                    console.error("Supabase Profile Insert Error:", pError);
                    throw new Error(pError.message);
                }

                if (role === 'DOCTOR') {
                    let { data: maxDocIdData } = await supabase.from('Doctors').select('id').order('id', { ascending: false }).limit(1);
                    const nextDocId = (maxDocIdData && maxDocIdData.length > 0) ? (Number(maxDocIdData[0].id) + 1) : 1;

                    const { error: dError } = await supabase
                        .from('Doctors')
                        .insert({
                            id: nextDocId,
                            user_id: profile.id,
                            name: name,
                            specialty: 'General Practitioner',
                            area: 'Johannesburg',
                            is_available: true,
                            verification_status: 'pending',
                            profile_completed: false,
                            is_online: true,
                            gig_mode_enabled: true
                        });
                    if (dError) {
                        console.error("Supabase Doctor Insert Error:", dError);
                        throw new Error(dError.message);
                    }
                }

                return new Response(JSON.stringify({
                    id: profile.id,
                    email: profile.email,
                    name: profile.name,
                    role: profile.role,
                    credits: profile.credits
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if ((path === '/api/auth/login' || path === '/api/auth/token') && method === 'POST') {
                let email = '';
                let password = '';
                if (init.body instanceof FormData) {
                    email = init.body.get('username');
                    password = init.body.get('password');
                } else if (init.body instanceof URLSearchParams) {
                    email = init.body.get('username') || init.body.get('email');
                    password = init.body.get('password');
                } else if (typeof init.body === 'string') {
                    try {
                        const parsed = JSON.parse(init.body);
                        email = parsed.username || parsed.email;
                        password = parsed.password;
                    } catch {
                        const params = new URLSearchParams(init.body);
                        email = params.get('username') || params.get('email');
                        password = params.get('password');
                    }
                }

                // Support mapping old domains to bypass Supabase blacklist constraints
                let originalEmail = email;
                if (email === 'test3@test.com') email = 'test3@sbtiinnovation.co.za';
                if (email === 'sam@docmail.com') email = 'sam@sbtiinnovation.co.za';

                // Check if profile exists in Profiles table
                console.log("Checking profile in database for email:", email);
                let { data: profile, error: selError } = await supabase.from('Profiles').select('*').eq('email', email).single();
                if (selError) {
                    console.log("Profile selection error (expected if new user):", selError);
                }
                
                // If profile doesn't exist (e.g. demo accounts on a new DB instance), create it on-the-fly
                if (!profile) {
                    console.log("Profile not found. Creating on-the-fly for email:", email);
                    const role = email.includes('admin') ? 'ADMIN' :
                                 (email.includes('doc') || email.includes('sam')) ? 'DOCTOR' : 'PATIENT';
                    const name = role === 'ADMIN' ? 'Administrator' :
                                 role === 'DOCTOR' ? 'Dr. Sam' : 'Demo Patient';
                    
                    // Query max ID to avoid sequence desynchronization duplicate key violations
                    let { data: maxIdData } = await supabase.from('Profiles').select('id').order('id', { ascending: false }).limit(1);
                    const nextId = (maxIdData && maxIdData.length > 0) ? (Number(maxIdData[0].id) + 1) : 1;

                    const { data: newProfile, error: insError } = await supabase.from('Profiles').insert({
                        id: nextId,
                        email,
                        name,
                        role,
                        credits: 0
                    }).select().single();
                    
                    if (insError) {
                        console.error("Profile on-the-fly insert error:", insError);
                        throw new Error("Failed to auto-create profile: " + insError.message);
                    }
                    profile = newProfile;

                    if (role === 'DOCTOR' && profile) {
                        let { data: maxDocIdData } = await supabase.from('Doctors').select('id').order('id', { ascending: false }).limit(1);
                        const nextDocId = (maxDocIdData && maxDocIdData.length > 0) ? (Number(maxDocIdData[0].id) + 1) : 1;

                        const { error: docInsError } = await supabase.from('Doctors').insert({
                            id: nextDocId,
                            user_id: profile.id,
                            name,
                            specialty: 'Cardiologist',
                            area: 'Sandton, JHB',
                            consultation_fee: 800,
                            is_available: true,
                            verification_status: 'pending',
                            profile_completed: true,
                            is_online: true,
                            gig_mode_enabled: true
                        });
                        if (docInsError) {
                            console.error("Doctor on-the-fly insert error:", docInsError);
                        }
                    }
                }

                if (!profile) {
                    throw new Error("Could not retrieve or create user profile in database.");
                }

                // Emulate token and bypass GoTrue Auth entirely to avoid rate-limiting
                const mockAccessToken = `mock_token_for_${email}`;
                localStorage.setItem('emulated_user_email', email);

                return new Response(JSON.stringify({
                    access_token: mockAccessToken,
                    token_type: 'bearer',
                    user: {
                        id: profile.id,
                        email: originalEmail, // Return original email to match frontend expectation
                        name: profile.name,
                        role: profile.role,
                        credits: profile.credits,
                        somnia_address: '0x' + '0'.repeat(40)
                    }
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/auth/me' && method === 'GET') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) {
                    return new Response(JSON.stringify({ detail: 'Session expired' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
                }

                let { data: profile } = await supabase.from('Profiles').select('*').eq('email', emulatedEmail).single();
                if (!profile) {
                    return new Response(JSON.stringify({ detail: 'Profile not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
                }

                // Match original login expectations
                const displayEmail = emulatedEmail === 'test3@sbtiinnovation.co.za' ? 'test3@test.com' :
                                     emulatedEmail === 'sam@sbtiinnovation.co.za' ? 'sam@docmail.com' : emulatedEmail;

                return new Response(JSON.stringify({
                    id: profile.id,
                    email: displayEmail,
                    name: profile.name,
                    role: profile.role,
                    credits: profile.credits,
                    somnia_address: '0x' + '0'.repeat(40)
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/auth/logout' && method === 'POST') {
                localStorage.removeItem('emulated_user_email');
                return new Response(JSON.stringify({ message: 'Logged out successfully' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            // --- DOCTORS ---
            if (path === '/api/doctors' && method === 'GET') {
                const { data: doctors, error } = await supabase.from('Doctors').select('*');
                if (error) throw new Error(error.message);

                if (doctors.length === 0) {
                    // Seed initial demo doctor
                    let { data: samProfile } = await supabase.from('Profiles').select('*').eq('email', 'sam@sbtiinnovation.co.za').single();
                    if (!samProfile) {
                        let { data: maxIdData } = await supabase.from('Profiles').select('id').order('id', { ascending: false }).limit(1);
                        const nextId = (maxIdData && maxIdData.length > 0) ? (Number(maxIdData[0].id) + 1) : 1;

                        const { data: newProfile } = await supabase.from('Profiles').insert({
                            id: nextId,
                            email: 'sam@sbtiinnovation.co.za',
                            name: 'Dr. Sam',
                            role: 'DOCTOR'
                        }).select().single();
                        samProfile = newProfile;
                    }
                    if (samProfile) {
                        let { data: maxDocIdData } = await supabase.from('Doctors').select('id').order('id', { ascending: false }).limit(1);
                        const nextDocId = (maxDocIdData && maxDocIdData.length > 0) ? (Number(maxDocIdData[0].id) + 1) : 1;

                        await supabase.from('Doctors').insert({
                            id: nextDocId,
                            user_id: samProfile.id,
                            name: 'Dr. Sam',
                            specialty: 'Cardiologist',
                            area: 'Sandton, JHB',
                            consultation_fee: 800,
                            is_available: true,
                            verification_status: 'verified',
                            profile_completed: true,
                            is_online: true,
                            gig_mode_enabled: true
                        });
                    }
                    const { data: seededDocs } = await supabase.from('Doctors').select('*');
                    const verifiedSeeded = seededDocs.filter(d => d.verification_status === 'verified' || d.verification_status === 'basic');
                    return new Response(JSON.stringify(verifiedSeeded), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }

                const verifiedDoctors = doctors.filter(d => d.verification_status === 'verified' || d.verification_status === 'basic');
                return new Response(JSON.stringify(verifiedDoctors), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path.startsWith('/api/doctors/') && method === 'GET') {
                const docId = path.split('/').pop();
                const { data: doctor, error } = await supabase.from('Doctors').select('*').eq('id', docId).single();
                if (error) throw new Error(error.message);
                return new Response(JSON.stringify(doctor), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            // --- APPOINTMENTS ---
            if (path === '/api/appointments' && method === 'GET') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');

                const { data: profile } = await supabase.from('Profiles').select('*').eq('email', emulatedEmail).single();

                let query = supabase.from('appointments').select('*, Profiles(name), Doctors(name)');
                if (profile.role === 'DOCTOR') {
                    const { data: doctor } = await supabase.from('Doctors').select('id').eq('user_id', profile.id).single();
                    if (doctor) {
                        query = query.eq('doctor_id', doctor.id);
                    }
                } else {
                    query = query.eq('patient_id', profile.id);
                }

                const { data: appts, error } = await query;
                if (error) throw new Error(error.message);

                const formatted = appts.map(a => ({
                    id: a.id,
                    patient_id: a.patient_id,
                    doctor_id: a.doctor_id,
                    timestamp: a.timestamp,
                    appointment_type: a.appointment_type,
                    status: a.status,
                    reason: a.reason,
                    price_credits: a.price_credits,
                    payment_method: a.payment_method,
                    escrow_status: a.escrow_status,
                    doctor_name: a.Doctors?.name || 'Dr. Sam',
                    patient_name: a.Profiles?.name || 'Patient'
                }));

                return new Response(JSON.stringify(formatted), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/appointments' && method === 'POST') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');

                const { data: profile } = await supabase.from('Profiles').select('*').eq('email', emulatedEmail).single();
                const body = JSON.parse(init.body);

                const { data: doctor } = await supabase.from('Doctors').select('*').eq('id', body.doctor_id).single();
                if (!doctor) throw new Error('Doctor not found');

                const isNurseDoc = (doctor.specialty && doctor.specialty.toLowerCase().includes('nurse')) || 
                                   (doctor.name && doctor.name.toLowerCase().includes('nurse'));
                
                let basePrice = 800;
                if (body.service_tier === 'QUICK_CHAT' || isNurseDoc) {
                    basePrice = 450;
                } else if (body.service_tier === 'PRESCRIPTION_REVIEW') {
                    basePrice = 80;
                } else if (body.service_tier === 'REPORT_ANALYSIS') {
                    basePrice = 120;
                }
                
                const distance = body.appointment_type === 'INPERSON' ? (Number(body.distance_km) || 0) : 0;
                const fee = basePrice + (distance * 30);

                if (body.payment_method === 'credits') {
                    if (profile.credits < fee) throw new Error('Insufficient credits');
                    await supabase.from('Profiles').update({ credits: profile.credits - fee }).eq('id', profile.id);
                    const { data: docProfile } = await supabase.from('Profiles').select('*').eq('id', doctor.user_id).single();
                    if (docProfile) {
                        await supabase.from('Profiles').update({ credits: (docProfile.credits || 0) + fee }).eq('id', docProfile.id);
                    }
                }

                let { data: maxApptIdData } = await supabase.from('appointments').select('id').order('id', { ascending: false }).limit(1);
                const nextApptId = (maxApptIdData && maxApptIdData.length > 0) ? (Number(maxApptIdData[0].id) + 1) : 1;

                const { data: appt, error } = await supabase.from('appointments').insert({
                    id: nextApptId,
                    patient_id: profile.id,
                    doctor_id: body.doctor_id,
                    timestamp: body.timestamp,
                    appointment_type: body.appointment_type || 'VIDEO',
                    status: 'SCHEDULED',
                    reason: body.reason,
                    price_credits: fee,
                    payment_method: body.payment_method || 'credits',
                    escrow_status: (body.payment_method === 'somnia' || body.payment_method === 't800') ? 'HELD' : 'NONE'
                }).select().single();

                if (error) throw new Error(error.message);
                appt.doctor_name = doctor.name;
                appt.patient_name = profile.name;

                return new Response(JSON.stringify(appt), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path.startsWith('/api/appointments/') && method === 'DELETE') {
                const apptId = path.split('/').pop();
                const { error } = await supabase.from('appointments').delete().eq('id', apptId);
                if (error) throw new Error(error.message);
                return new Response(JSON.stringify({ status: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path.startsWith('/api/appointments/') && path.endsWith('/complete') && method === 'POST') {
                const apptId = path.split('/')[3];
                const { error } = await supabase.from('appointments').update({ status: 'COMPLETED' }).eq('id', apptId);
                if (error) throw new Error(error.message);
                return new Response(JSON.stringify({ status: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            // --- RECORDS & PRESCRIPTIONS ---
            if (path === '/api/records' && method === 'GET') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');

                const { data: profile } = await supabase.from('Profiles').select('*').eq('email', emulatedEmail).single();

                let query = supabase.from('medical_records').select('*');
                if (profile.role === 'DOCTOR') {
                    const { data: doctor } = await supabase.from('Doctors').select('id').eq('user_id', profile.id).single();
                    if (doctor) query = query.eq('doctor_id', doctor.id);
                } else {
                    query = query.eq('patient_id', profile.id);
                }

                const { data: records, error } = await query;
                if (error) throw new Error(error.message);
                return new Response(JSON.stringify(records), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/records' && method === 'POST') {
                const body = JSON.parse(init.body);

                let { data: maxRecIdData } = await supabase.from('medical_records').select('id').order('id', { ascending: false }).limit(1);
                const nextRecId = (maxRecIdData && maxRecIdData.length > 0) ? (Number(maxRecIdData[0].id) + 1) : 1;

                const { data: record, error } = await supabase.from('medical_records').insert({
                    id: nextRecId,
                    patient_id: body.patient_id,
                    doctor_id: body.doctor_id,
                    appointment_id: body.appointment_id,
                    summary: body.summary
                }).select().single();

                if (error) throw new Error(error.message);
                return new Response(JSON.stringify(record), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/prescriptions' && method === 'GET') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');

                const { data: profile } = await supabase.from('Profiles').select('*').eq('email', emulatedEmail).single();

                let query = supabase.from('prescriptions').select('*');
                if (profile.role === 'DOCTOR') {
                    const { data: doctor } = await supabase.from('Doctors').select('id').eq('user_id', profile.id).single();
                    if (doctor) query = query.eq('doctor_id', doctor.id);
                } else {
                    query = query.eq('patient_id', profile.id);
                }

                const { data: pres, error } = await query;
                if (error) throw new Error(error.message);
                return new Response(JSON.stringify(pres), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/prescriptions' && method === 'POST') {
                const body = JSON.parse(init.body);

                let { data: maxPresIdData } = await supabase.from('prescriptions').select('id').order('id', { ascending: false }).limit(1);
                const nextPresId = (maxPresIdData && maxPresIdData.length > 0) ? (Number(maxPresIdData[0].id) + 1) : 1;

                const { data: prescription, error } = await supabase.from('prescriptions').insert({
                    id: nextPresId,
                    appointment_id: body.appointment_id,
                    patient_id: body.patient_id,
                    doctor_id: body.doctor_id,
                    medication: body.medication,
                    dosage: body.dosage,
                    instructions: body.instructions
                }).select().single();

                if (error) throw new Error(error.message);
                return new Response(JSON.stringify(prescription), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            // --- ADMIN DASHBOARD ---
            if (path === '/api/dashboard/admin/system-stats' && method === 'GET') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');

                const [pRes, dRes, aRes] = await Promise.all([
                    supabase.from('Profiles').select('credits'),
                    supabase.from('Doctors').select('is_online'),
                    supabase.from('appointments').select('status, price_credits')
                ]);

                if (pRes.error) throw new Error(pRes.error.message);
                if (dRes.error) throw new Error(dRes.error.message);
                if (aRes.error) throw new Error(aRes.error.message);

                const profiles = pRes.data || [];
                const doctors = dRes.data || [];
                const appts = aRes.data || [];

                const total_users = profiles.length;
                const total_credits_in_system = profiles.reduce((sum, p) => sum + (Number(p.credits) || 0), 0);
                const total_doctors = doctors.length;
                const online_doctors = doctors.filter(d => d.is_online).length;

                const total_appointments = appts.length;
                const total_revenue_cents = appts.reduce((sum, a) => sum + (Number(a.price_credits) || 0), 0) * 100;

                const appointments_scheduled = appts.filter(a => a.status === 'SCHEDULED').length;
                const appointments_active = appts.filter(a => a.status === 'ACTIVE').length;
                const appointments_completed = appts.filter(a => a.status === 'COMPLETED').length;
                const appointments_cancelled = appts.filter(a => a.status === 'CANCELLED').length;

                return new Response(JSON.stringify({
                    total_users,
                    total_appointments,
                    total_doctors,
                    online_doctors,
                    total_revenue_cents,
                    total_credits_in_system,
                    appointments_scheduled,
                    appointments_active,
                    appointments_completed,
                    appointments_cancelled
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path.startsWith('/api/dashboard/admin/users') && method === 'GET') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');

                const urlObj = new URL(path, window.location.origin);
                const q = urlObj.searchParams.get('q');

                let query = supabase.from('Profiles').select('*');
                const { data: users, error } = await query;
                if (error) throw new Error(error.message);

                let filtered = users || [];
                if (q) {
                    const qLower = q.toLowerCase();
                    filtered = filtered.filter(u => 
                        (u.name && u.name.toLowerCase().includes(qLower)) || 
                        (u.email && u.email.toLowerCase().includes(qLower))
                    );
                }

                const mapped = filtered.map(u => ({
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    role: u.role,
                    credits: u.credits || 0,
                    t800_balance: 0,
                    is_active: true,
                    created_at: u.created_at || new Date().toISOString()
                }));

                return new Response(JSON.stringify(mapped), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/dashboard/admin/doctors' && method === 'GET') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');

                const [dRes, aRes] = await Promise.all([
                    supabase.from('Doctors').select('*'),
                    supabase.from('appointments').select('*')
                ]);

                if (dRes.error) throw new Error(dRes.error.message);
                if (aRes.error) throw new Error(aRes.error.message);

                const doctors = dRes.data || [];
                const appointments = aRes.data || [];

                const mapped = doctors.map(d => {
                    const docAppts = appointments.filter(a => a.doctor_id === d.id);
                    const total_earnings = docAppts.filter(a => a.status === 'COMPLETED').reduce((sum, a) => sum + (Number(a.price_credits) || 0), 0);
                    const pending_earnings = docAppts.filter(a => a.status === 'SCHEDULED' || a.status === 'ACTIVE').reduce((sum, a) => sum + (Number(a.price_credits) || 0), 0);

                    return {
                        id: d.id,
                        name: d.name,
                        specialty: d.specialty,
                        is_online: d.is_online,
                        verification_status: d.verification_status,
                        total_earnings,
                        pending_earnings,
                        consultation_fee: d.consultation_fee
                    };
                });

                return new Response(JSON.stringify(mapped), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path.startsWith('/api/dashboard/admin/appointments') && method === 'GET') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');

                const urlObj = new URL(path, window.location.origin);
                const statusFilter = urlObj.searchParams.get('status');

                const [aRes, pRes, dRes] = await Promise.all([
                    supabase.from('appointments').select('*'),
                    supabase.from('Profiles').select('id, name, email'),
                    supabase.from('Doctors').select('id, name, specialty')
                ]);

                if (aRes.error) throw new Error(aRes.error.message);
                if (pRes.error) throw new Error(pRes.error.message);
                if (dRes.error) throw new Error(dRes.error.message);

                let list = aRes.data || [];
                const profiles = pRes.data || [];
                const doctors = dRes.data || [];

                if (statusFilter) {
                    list = list.filter(a => a.status === statusFilter);
                }

                const mapped = list.map(a => {
                    const pat = profiles.find(p => p.id === a.patient_id);
                    const doc = doctors.find(d => d.id === a.doctor_id);

                    return {
                        id: a.id,
                        patient_name: pat ? pat.name : 'Patient',
                        patient_email: pat ? pat.email : '',
                        doctor_name: doc ? doc.name : 'Doctor',
                        doctor_specialty: doc ? doc.specialty : '',
                        service_tier: a.service_tier || 'VIDEO_CALL',
                        appointment_type: a.appointment_type,
                        timestamp: a.timestamp,
                        status: a.status,
                        escrow_status: a.escrow_status || 'NONE',
                        base_price: a.price_credits || 0
                    };
                });

                return new Response(JSON.stringify(mapped), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/dashboard/admin/transactions' && method === 'GET') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');

                const [tRes, pRes] = await Promise.all([
                    supabase.from('transactions').select('*').order('created_at', { ascending: false }),
                    supabase.from('Profiles').select('id, name')
                ]);

                if (tRes.error) throw new Error(tRes.error.message);
                if (pRes.error) throw new Error(pRes.error.message);

                const txns = tRes.data || [];
                const profiles = pRes.data || [];

                const mapped = txns.map(t => {
                    const pat = profiles.find(p => p.id === t.user_id);
                    return {
                        id: t.id,
                        user_name: pat ? pat.name : 'User',
                        transaction_type: t.transaction_type,
                        amount: t.amount,
                        payment_status: t.payment_status,
                        created_at: t.created_at
                    };
                });

                return new Response(JSON.stringify(mapped), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/dashboard/admin/notify-all' && method === 'POST') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');
                return new Response(JSON.stringify({ success: true, message: 'Broadcast notifications sent' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            // --- CREDITS & EARNINGS ---
            if (path === '/api/credits/balance' && method === 'GET') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');
                const { data: profile } = await supabase.from('Profiles').select('credits').eq('email', emulatedEmail).single();
                return new Response(JSON.stringify({ credits: profile ? profile.credits : 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/credits/transactions' && method === 'GET') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');
                const { data: profile } = await supabase.from('Profiles').select('id').eq('email', emulatedEmail).single();
                const { data: txns, error } = await supabase.from('transactions').select('*').eq('user_id', profile.id).order('created_at', { ascending: false });
                if (error) throw new Error(error.message);
                return new Response(JSON.stringify(txns || []), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/credits/purchase' && method === 'POST') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');
                const body = JSON.parse(init.body);
                const amount = Number(body.amount);

                let { data: profile } = await supabase.from('Profiles').select('*').eq('email', emulatedEmail).single();
                const newCredits = (profile.credits || 0) + amount;

                const { data: updatedProfile, error: uError } = await supabase
                    .from('Profiles')
                    .update({ credits: newCredits })
                    .eq('id', profile.id)
                    .select()
                    .single();
                if (uError) throw new Error(uError.message);

                let { data: maxTxIdData } = await supabase.from('transactions').select('id').order('id', { ascending: false }).limit(1);
                const nextTxId = (maxTxIdData && maxTxIdData.length > 0) ? (Number(maxTxIdData[0].id) + 1) : 1;

                await supabase.from('transactions').insert({
                    id: nextTxId,
                    user_id: profile.id,
                    amount: amount,
                    transaction_type: 'CREDIT_PURCHASE',
                    description: `Purchased ${amount} credits`,
                    payment_method: 'PayFast Mock',
                    payment_status: 'completed'
                });

                return new Response(JSON.stringify({ new_balance: updatedProfile.credits }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/credits/doctor/earnings' && method === 'GET') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');
                const { data: profile } = await supabase.from('Profiles').select('*').eq('email', emulatedEmail).single();
                const { data: doctor } = await supabase.from('Doctors').select('*').eq('user_id', profile.id).single();
                return new Response(JSON.stringify({
                    total_earnings: doctor ? (doctor.total_earnings || 0) : 1200,
                    pending_earnings: doctor ? (doctor.pending_earnings || 0) : 300
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/profile/doctor' && method === 'GET') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');
                const { data: profile } = await supabase.from('Profiles').select('*').eq('email', emulatedEmail).single();
                const { data: doctor } = await supabase.from('Doctors').select('*').eq('user_id', profile.id).single();
                return new Response(JSON.stringify(doctor), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/profile/doctor/gig-mode' && method === 'POST') {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');
                const { data: profile } = await supabase.from('Profiles').select('*').eq('email', emulatedEmail).single();
                const body = JSON.parse(init.body);
                const { data: updated } = await supabase.from('Doctors')
                    .update({ is_online: body.is_online, gig_mode_enabled: body.is_online })
                    .eq('user_id', profile.id)
                    .select()
                    .single();
                return new Response(JSON.stringify(updated), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/profile/patient' && (method === 'POST' || method === 'PUT')) {
                const emulatedEmail = localStorage.getItem('emulated_user_email');
                if (!emulatedEmail) throw new Error('Not authenticated');
                const body = JSON.parse(init.body);
                const { data: updated, error: uError } = await supabase.from('Profiles')
                    .update({ name: body.preferred_name || body.name })
                    .eq('email', emulatedEmail)
                    .select()
                    .single();
                if (uError) throw new Error(uError.message);
                return new Response(JSON.stringify(updated), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            // --- YOCO PAYMENTS ---
            if (path === '/api/yoco/initiate' && method === 'POST') {
                const body = JSON.parse(init.body);
                return new Response(JSON.stringify({
                    checkout_url: window.location.origin + `/yoco_checkout.html?appointment_id=${body.appointment_id}&amount=${body.amount_zar}`
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/yoco/webhook' && method === 'POST') {
                return new Response(JSON.stringify({ status: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            // --- SOMNIA BLOCKCHAIN & AGENT EMULATION ---
            if (path === '/api/somnia/escrow/wallet/balance' && method === 'GET') {
                return new Response(JSON.stringify({ balance_eth: "100.00", address: "0x1234abcd5678efgh9012ijkl3456mnop7890qrst" }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/somnia/agent/t800/balance' && method === 'GET') {
                return new Response(JSON.stringify({ t800_balance: 50.00, t800_fee_per_invocation: 10 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/somnia/agent/t800/info' && method === 'GET') {
                return new Response(JSON.stringify({ name: 'T800', symbol: 'T800', decimals: 18, router_contract: "0x" + "a".repeat(40) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/somnia/agent/t800/faucet' && method === 'POST') {
                return new Response(JSON.stringify({ status: 'success', balance: 100 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/somnia/agent/stt/cost' && method === 'GET') {
                return new Response(JSON.stringify({ cost_stt: "0.01" }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/somnia/agent/credit-costs' && method === 'GET') {
                return new Response(JSON.stringify({ symptom_check: 10, drug_interaction: 15, health_tips: 5 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/somnia/agent/email' && method === 'POST') {
                return new Response(JSON.stringify({ status: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            // --- AI AGENTS SIMULATIONS ---
            if (path === '/api/somnia/agent/symptom-check' && method === 'POST') {
                return new Response(JSON.stringify({ request_id: 'symptom_' + Date.now() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/somnia/agent/drug-interaction' && method === 'POST') {
                return new Response(JSON.stringify({ request_id: 'drug_' + Date.now() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/somnia/agent/health-tips' && method === 'POST') {
                return new Response(JSON.stringify({ request_id: 'tips_' + Date.now() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/somnia/agent/generate-summary' && method === 'POST') {
                return new Response(JSON.stringify({ request_id: 'summary_' + Date.now() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/api/somnia/agent/stt/invoke' && method === 'POST') {
                return new Response(JSON.stringify({ request_id: 'stt_' + Date.now() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path.startsWith('/api/somnia/agent/result/') && method === 'GET') {
                const reqId = path.split('/').pop();
                let resultText = "Simulation complete.";
                if (reqId.startsWith('symptom_')) {
                    resultText = "Based on the reported symptoms (mild fever, coughing, fatigue), you may be experiencing a mild viral upper respiratory tract infection. Ensure rest, hydration, and consult a doctor if symptoms worsen.";
                } else if (reqId.startsWith('drug_')) {
                    resultText = "No severe interactions found between Aspirin and Paracetamol. However, do not exceed daily recommended dosages, and consult a healthcare provider.";
                } else if (reqId.startsWith('tips_')) {
                    resultText = "Daily Health Tip: Walking 30 minutes a day can dramatically improve cardiovascular health, reduce body fat, and boost muscle power.";
                } else if (reqId.startsWith('summary_')) {
                    resultText = "Patient Jabu visited Dr. Sam on the Doctors on Wheels platform. The patient reported mild symptoms and was advised to keep hydrated and rest.";
                } else if (reqId.startsWith('stt_')) {
                    resultText = "STT Simulation complete. The Somnia AI Agent analyzed your query and advises standard rest, hydration, and consultation with your practitioner if symptoms persist.";
                }
                return new Response(JSON.stringify({ status: 'completed', result: resultText }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            if (path.includes('/pay-with-') && method === 'POST') {
                return new Response(JSON.stringify({ status: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            // --- WAITING ROOMS & CHAT ---
            if (path.includes('/waiting-room/join') && method === 'POST') {
                return new Response(JSON.stringify({ status: 'success', waiting: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (path.includes('/waiting-room/leave') && method === 'POST') {
                return new Response(JSON.stringify({ status: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (path.startsWith('/api/chat/') && method === 'GET') {
                return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (path.startsWith('/api/chat/') && method === 'POST') {
                return new Response(JSON.stringify({ status: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            return new Response(JSON.stringify({ detail: 'Endpoint emulator fallback' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        } catch (err) {
            console.error('Supabase emulator error:', err);
            return new Response(JSON.stringify({ detail: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
    }
})();
