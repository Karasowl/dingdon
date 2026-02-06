// app/api/me/avatar/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const formData = await req.formData();
        const file = formData.get('avatar') as File | null;
        if (!file) throw new Error('No file provided.');

        const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB
        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json({ error: 'File type not allowed. Use JPEG, PNG, WebP, or GIF.' }, { status: 400 });
        }
        if (file.size > MAX_SIZE) {
            return NextResponse.json({ error: 'File too large. Max 5MB.' }, { status: 400 });
        }

        const fileExtension = file.name.split('.').pop();
        const fileName = `user-${session.user.id}-${Date.now()}.${fileExtension}`;
        
        const { error: uploadError } = await supabaseAdmin.storage
            .from('avatars')
            .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data } = supabaseAdmin.storage
            .from('avatars')
            .getPublicUrl(fileName);

        return NextResponse.json({ avatarUrl: data.publicUrl });

    } catch (error: any) {
        console.error('Error uploading avatar:', error);
        return NextResponse.json({ error: 'Failed to upload avatar.' }, { status: 500 });
    }
}