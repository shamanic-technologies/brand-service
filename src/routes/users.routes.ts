import { Router, Request, Response } from 'express';
import { eq, desc, sql } from 'drizzle-orm';
import { db, users } from '../db';

const router = Router();

/**
 * GET /users/list
 * Returns all users from brand-service users table.
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const result = await db
      .select({
        id: users.id,
        user_id: users.userId,
        created_at: users.createdAt,
        updated_at: users.updatedAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    return res.status(200).json({
      users: result,
      stats: {
        total: result.length,
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
    const userResult = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.userId, inputUserId))
      .limit(1);

    if (userResult.length === 0) {
      return res.status(404).json({
        error: 'User not found',
        message: `No user found with user_id: ${inputUserId}`,
      });
    }

    const dbUserId = userResult[0].id;

    // Delete the user (cascades will handle related data)
    await db.delete(users).where(eq(users.id, dbUserId));

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
