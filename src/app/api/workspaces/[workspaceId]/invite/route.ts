// app/api/workspaces/[workspaceId]/invite/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function POST(
    request: Request,
    //{ params }: { params: { workspaceId: string } }
    context: {
        params: Promise<{ workspaceId: string }>
    }
) {
    try {
        const session = await getServerSession(authOptions);
        const { workspaceId } = await context.params;

        // 1. Verificación de permisos
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        if (session.user.workspaceId !== workspaceId || session.user.workspaceRole !== 'admin') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const { name, email, password, role } = await request.json();
        if (!name || !email || !password || !role) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Validar que el rol sea válido
        if (!['admin', 'agent'].includes(role)) {
            return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
        }

        // 2. Crear el usuario en Supabase Auth
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: email,
            password: password,
            email_confirm: true,
            user_metadata: { 
                full_name: name,
                name: name 
            }
        });

        if (authError) {
            if (authError.message.includes("User already registered")) {
                return NextResponse.json({ error: 'A user with this email already exists.' }, { status: 400 });
            }
            throw new Error(authError.message);
        }

        if (!authData.user) {
            return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
        }

        // 3. Actualizar el perfil creado por el trigger con datos adicionales
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .update({
                name: name,
                app_role: 'agent' // Todos los invitados son 'agent' a nivel de aplicación
            })
            .eq('id', authData.user.id);

        if (profileError) {
            console.error('Error updating profile:', profileError);
            // Si falla la actualización del perfil, intentamos eliminar el usuario creado
            await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
            return NextResponse.json({ error: 'Failed to update user profile' }, { status: 500 });
        }

        // 4. Crear o actualizar membresía (atomic upsert to prevent race conditions)
        const { error: membershipError } = await supabaseAdmin
            .from('workspace_members')
            .upsert({
                workspace_id: workspaceId,
                user_id: authData.user.id,
                role: role
            }, { onConflict: 'workspace_id,user_id' });

        if (membershipError) {
            console.error('Error upserting workspace membership:', membershipError);
            await supabaseAdmin.from('profiles').delete().eq('id', authData.user.id);
            await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
            return NextResponse.json({ error: 'Failed to create workspace membership' }, { status: 500 });
        }

        // 5. Respuesta exitosa
        return NextResponse.json({ 
            success: true, 
            user: {
                id: authData.user.id,
                email: authData.user.email,
                name: name,
                role: role
            }
        });

    } catch (error: any) {
        console.error('Error in invite route:', error);
        return NextResponse.json({ 
            error: error.message || 'Internal server error' 
        }, { status: 500 });
    }
}