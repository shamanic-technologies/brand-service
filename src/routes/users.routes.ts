import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

/**
 * GET /users/list
 * Returns all users from company-service users table.
 * Used by client-service to check user existence across services.
 */
router.get('/list', async (req: Request, res: Response) => {
  let client;

  try {
    client = await pool.connect();

    const result = await client.query(`
      SELECT 
        id,
        clerk_user_id,
        created_at,
        updated_at
      FROM users
      ORDER BY created_at DESC
    `);

    return res.status(200).json({
      users: result.rows,
      stats: {
        total: result.rows.length,
      },
    });
  } catch (error) {
    console.error('[users/list] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch users list' });
  } finally {
    if (client) client.release();
  }
});

/**
 * DELETE /users/:clerkUserId
 * Deletes a user from company-service database.
 * Used by client-service for user deletion orchestration.
 */
router.delete('/:clerkUserId', async (req: Request, res: Response) => {
  const { clerkUserId } = req.params;

  if (!clerkUserId) {
    return res.status(400).json({ error: 'Clerk User ID is required' });
  }

  let client;

  try {
    client = await pool.connect();

    // Find the user
    const userResult = await client.query(
      'SELECT id FROM users WHERE clerk_user_id = $1',
      [clerkUserId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'User not found',
        message: `No user found with clerk_user_id: ${clerkUserId}` 
      });
    }

    const userId = userResult.rows[0].id;

    // Delete organization_users associations first (if exists)
    const orgUsersResult = await client.query(
      'DELETE FROM organization_users WHERE user_id = $1',
      [userId]
    );
    console.log(`[users/delete] Deleted ${orgUsersResult.rowCount} organization_users entries for user ${clerkUserId}`);

    // Delete the user
    await client.query(
      'DELETE FROM users WHERE id = $1',
      [userId]
    );

    console.log(`[users/delete] Successfully deleted user ${clerkUserId} from company-service`);

    return res.status(200).json({
      success: true,
      message: `User ${clerkUserId} deleted successfully from company-service`,
      deleted_organization_users: orgUsersResult.rowCount,
    });
  } catch (error) {
    console.error('[users/delete] Error:', error);
    return res.status(500).json({ error: 'Failed to delete user' });
  } finally {
    if (client) client.release();
  }
});

export default router;
