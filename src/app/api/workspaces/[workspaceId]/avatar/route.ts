// app/api/workspaces/[workspaceId]/avatar/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function POST(
    req: NextRequest,
    context: {
        params: Promise<{ workspaceId: string }>
    }
) {
    const session = await getServerSession(authOptions);
    const { workspaceId } = await context.params;

    // --- Seguridad ---
    // 1. El usuario debe estar logueado.
    // 2. El usuario debe pertenecer al workspace para el que intenta subir un avatar.
    if (!session || session.user.workspaceId !== workspaceId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        // 1. Obtener los datos del formulario (la imagen)
        const formData = await req.formData();
        const file = formData.get('avatar') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
        }

        const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB
        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json({ error: 'File type not allowed. Use JPEG, PNG, WebP, or GIF.' }, { status: 400 });
        }
        if (file.size > MAX_SIZE) {
            return NextResponse.json({ error: 'File too large. Max 5MB.' }, { status: 400 });
        }

        // 2. Crear un nombre de archivo único para evitar sobrescribir imágenes
        const fileExtension = file.name.split('.').pop();
        const fileName = `${workspaceId}-${Date.now()}.${fileExtension}`;
        
        // 3. Subir el archivo al bucket "avatars" de Supabase Storage
        const { error: uploadError } = await supabaseAdmin.storage
            .from('avatars')
            .upload(fileName, file);

        if (uploadError) {
            // Si hay un error durante la subida, lo lanzamos para que lo capture el catch
            throw uploadError;
        }

        // 4. Obtener la URL pública del archivo que acabamos de subir
        const { data } = supabaseAdmin.storage
            .from('avatars')
            .getPublicUrl(fileName);

        if (!data.publicUrl) {
            throw new Error('Could not get public URL for the uploaded avatar.');
        }

        // 5. Devolver la URL pública al frontend
        return NextResponse.json({ avatarUrl: data.publicUrl });

    } catch (error: any) {
        console.error('Error uploading avatar:', error);
        return NextResponse.json({ error: 'Failed to upload avatar.' }, { status: 500 });
    }
}