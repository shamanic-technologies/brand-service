import { Router, Request, Response } from 'express';
import { pool } from '../db/utils';

const router = Router();

/**
 * GET /users/list
 * Returns all users from brand-service users table.
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, user_id, created_at, updated_at
       FROM users
       ORDER BY created_at DESC`
    );

    return res.status(200).json({
      users: result.rows,
      stats: {
        total: result.rows.length,
      },
    });
  } catch (error) {
    console.error('[users/list] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch users list' });
  }
});

/**
 * DELETE /users/:userId
 * Deletes a user from brand-service database.
 */
router.delete('/:userId', async (req: Request, res: Response) => {
  const { userId: inputUserId } = req.params;

  if (!inputUserId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    // Find the user
    const userResult = await pool.query(
      'SELECT id FROM users WHERE user_id = $1 LIMIT 1',
      [inputUserId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found',
        message: `No user found with user_id: ${inputUserId}`,
      });
    }

    const dbUserId = userResult.rows[0].id;

    // Delete the user (cascades will handle related data)
    await pool.query('DELETE FROM users WHERE id = $1', [dbUserId]);

    console.log(`[users/delete] Successfully deleted user ${inputUserId}`);

    return res.status(200).json({
      success: true,
      message: `User ${inputUserId} deleted successfully`,
    });
  } catch (error) {
    console.error('[users/delete] Error:', error);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
