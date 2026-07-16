import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Initial staff members — always present in the system.
 * These are merged with any staff added via the admin panel.
 */
const INITIAL_STAFF = [
  { name: "Rodolfo Dayot Luga II", email: "rluga@ececontactcenters.com", role: "Programmer", departments: ["Workforce"] },
  { name: "John Mark Bigtas Trias", email: "jtrias@ececontactcenters.com", role: "Programmer", departments: ["Workforce"] },
  { name: "Lemuel De Leon Ching", email: "lching@ececontactcenters.com", role: "Admin", departments: ["Workforce"] },
  { name: "Gianne Carlo Fernandez Mangampat", email: "gmangampat@ececonsultinggroup.net", role: "Programmer", departments: ["Workforce"] },
  { name: "Regie Delvo Gajelomo", email: "rgajelomo@ececonsultinggroup.com", role: "Programmer", departments: ["Workforce"] },
  { name: "Jomari Urfe Garces", email: "jomari.garces@ececontactcenters.com", role: "Admin", departments: ["Workforce"] },
  // Main Admin has all-access (also enforced by MAIN_ADMIN_EMAIL rule client-side).
  { name: "Main Admin", email: "wmt@ececontactcenters.com", role: "Admin", departments: ["Executives", "Operations", "Workforce"] },
];

export const getStaff = query({
  args: {},
  handler: async (ctx) => {
    const savedStaff = await ctx.db.query("staff").collect();

    // Merge: initial staff are always present, saved staff can override
    const staffMap: Record<string, any> = {};
    INITIAL_STAFF.forEach((s) => {
      staffMap[s.email.toLowerCase()] = { ...s };
    });
    savedStaff.forEach((s) => {
      staffMap[s.email.toLowerCase()] = s;
    });

    // Strip sensitive fields AND heartbeat data before sending to client.
    // Presence is handled by the separate getOnlineStatus query to save bandwidth.
    return Object.values(staffMap)
      .filter((s: any) => s.role !== "Revoked")
      .map(({ password, securityAnswer, securityQuestion, resetCode, resetCodeExpiry, lastSeen, ...safe }: any) => ({
        ...safe,
        // Default only TRULY-ABSENT department membership (legacy/seed rows) to
        // Workforce. An explicit empty array MUST be preserved as "no access" —
        // coercing [] -> ["Workforce"] would silently re-grant access an admin
        // just revoked (and Workforce grants ALL workspaces). Access decisions
        // downstream fail closed on [].
        departments: Array.isArray(safe.departments) ? safe.departments : ["Workforce"],
        password: password ? "********" : undefined,
        securityAnswer: securityAnswer ? "********" : undefined,
        securityQuestion: securityQuestion
      }));
  },
});

export const getOnlineStatus = query({
  args: {},
  handler: async (ctx) => {
    const heartbeats = await ctx.db.query("heartbeats").collect();
    const now = Date.now();
    const onlineMap: Record<string, boolean> = {};
    
    heartbeats.forEach(hb => {
      // Consider online if seen in the last 60 seconds
      if (now - hb.lastSeen < 60000) {
        onlineMap[hb.email.toLowerCase()] = true;
      }
    });
    
    return onlineMap;
  }
});

export const heartbeat = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const lowerEmail = args.email.toLowerCase();
    const existing = await ctx.db
      .query("heartbeats")
      .withIndex("by_email", (q) => q.eq("email", lowerEmail))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { lastSeen: Date.now() });
    } else {
      await ctx.db.insert("heartbeats", {
        email: lowerEmail,
        lastSeen: Date.now(),
      });
    }
  },
});

// --- Hashing Helpers ---
async function hashPassword(password: string) {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

export const login = mutation({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const lowerEmail = args.email.toLowerCase();
    const isMainAdmin = lowerEmail === "wmt@ececontactcenters.com";

    // --- Main Admin shortcut ---
    if (isMainAdmin) {
      if (args.password === "admin") {
        return { success: true, stage: "authenticated" };
      }
      return { success: false, error: "Incorrect password." };
    }

    // --- Lookup user in DB ---
    const dbUser = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", lowerEmail))
      .first();

    // Fall back to INITIAL_STAFF
    const initial = INITIAL_STAFF.find(
      (s) => s.email.toLowerCase() === lowerEmail
    );
    const user = dbUser || (initial ? { ...initial, password: undefined } : null);

    // --- Not found: attempt registration ---
    if (!user) {
      if (args.password === "admin") {
        const defaultName = lowerEmail.split("@")[0];
        await ctx.db.insert("staff", {
          name: defaultName,
          email: lowerEmail,
          role: "Pending",
        });
        return { success: true, stage: "denied" };
      }
      return { success: false, error: "You are not registered. Use the default password to register." };
    }

    // --- Pending approval ---
    if (user.role === "Pending") {
      return { success: true, stage: "denied" };
    }

    // --- Revoked ---
    if (user.role === "Revoked") {
      return { success: false, error: "Your access has been revoked by an administrator." };
    }

    // --- No personal password set: accept "admin" → go to set-password ---
    if (!user.password) {
      if (args.password === "admin") {
        return { success: true, stage: "set-password" };
      }
      return { success: false, error: "Incorrect password." };
    }

    // --- Validate personal password ---
    const inputHash = await hashPassword(args.password);
    
    // Check if stored password is a hash (SHA-256 hex is 64 chars) or plain text
    const isHash = user.password.length === 64 && /^[0-9a-f]+$/.test(user.password);
    
    if (isHash) {
      if (inputHash === user.password) {
        return { success: true, stage: "authenticated", role: user.role, hasSecurityQuestion: !!user.securityQuestion };
      }
    } else {
      // Fallback for existing plain-text passwords
      if (args.password === user.password) {
        // Auto-migrate to hash on successful login
        await ctx.db.patch(user._id, { password: inputHash });
        return { success: true, stage: "authenticated", role: user.role, hasSecurityQuestion: !!user.securityQuestion };
      }
    }

    return { success: false, error: "Incorrect password." };
  },
});

export const addStaff = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    role: v.string(),
    departments: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Don't add duplicates
    const existing = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .first();
    if (existing) return;
    await ctx.db.insert("staff", {
      name: args.name,
      email: args.email.toLowerCase(),
      role: args.role,
      // New members default to the Workforce workspace; admins can adjust via
      // the Department Membership sub-tab.
      departments: args.departments || ["Workforce"],
    });
  },
});

export const getStaffByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    // Check DB first
    const dbUser = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .first();
    if (dbUser) return dbUser; // Return even if Revoked/Pending

    // Fall back to INITIAL_STAFF
    const initial = INITIAL_STAFF.find(
      (s) => s.email.toLowerCase() === args.email.toLowerCase()
    );
    return initial ? { ...initial, _id: null, password: undefined } : null;
  },
});

export const setPassword = mutation({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .first();

    const hashedPassword = await hashPassword(args.password);
    if (existing) {
      await ctx.db.patch(existing._id, { password: hashedPassword });
    } else {
      // User is from INITIAL_STAFF but not yet in DB — create their DB record
      const initial = INITIAL_STAFF.find(
        (s) => s.email.toLowerCase() === args.email.toLowerCase()
      );
      if (initial) {
        await ctx.db.insert("staff", {
          name: initial.name,
          email: initial.email.toLowerCase(),
          role: initial.role,
          password: hashedPassword,
        });
      }
    }

    // Audit log
    await ctx.db.insert("securityLogs", {
      action: "PASSWORD_SET",
      userEmail: args.email.toLowerCase(),
      targetEmail: args.email.toLowerCase(),
      details: "User set a new password.",
      timestamp: Date.now(),
    });
  },
});

export const updateStaffRole = mutation({
  args: {
    staffEmail: v.string(),
    newRole: v.string(),
    actorEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const lowerEmail = args.staffEmail.toLowerCase();
    const actor = (args.actorEmail || "").toLowerCase();

    // Security: a user can never change their own role (no self-promotion /
    // self-demotion). Enforced here so it holds regardless of the UI.
    if (actor && actor === lowerEmail) {
      throw new Error("You cannot change your own role.");
    }

    const existing = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", lowerEmail))
      .first();

    if (existing) {
      console.log(`Updating role for ${lowerEmail} to ${args.newRole}`);
      await ctx.db.patch(existing._id, { role: args.newRole });
    } else {
      const initial = INITIAL_STAFF.find(
        (s) => s.email.toLowerCase() === lowerEmail
      );
      if (initial) {
        console.log(`Inserting initial staff ${lowerEmail} with role ${args.newRole}`);
        await ctx.db.insert("staff", {
          name: initial.name,
          email: initial.email.toLowerCase(),
          role: args.newRole,
        });
      }
    }

    // Audit log
    await ctx.db.insert("securityLogs", {
      action: "ROLE_CHANGED",
      userEmail: actor || "admin",
      targetEmail: lowerEmail,
      details: `Role updated to: ${args.newRole}`,
      timestamp: Date.now(),
    });
  },
});

/**
 * Update a staff member's department membership (the orthogonal RBAC axis that
 * gates which workspaces they can enter). Mirrors updateStaffRole: same
 * DB-exists-vs-INITIAL_STAFF-insert branch, same self-edit guard (a user cannot
 * change their own departments — no self-granting workspace access), and a
 * DEPARTMENT_CHANGED audit entry.
 */
export const updateStaffDepartment = mutation({
  args: {
    staffEmail: v.string(),
    departments: v.array(v.string()),
    actorEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const lowerEmail = args.staffEmail.toLowerCase();
    const actor = (args.actorEmail || "").toLowerCase();

    if (actor && actor === lowerEmail) {
      throw new Error("You cannot change your own department membership.");
    }

    const existing = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", lowerEmail))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { departments: args.departments });
    } else {
      const initial = INITIAL_STAFF.find((s) => s.email.toLowerCase() === lowerEmail);
      if (initial) {
        await ctx.db.insert("staff", {
          name: initial.name,
          email: initial.email.toLowerCase(),
          role: initial.role,
          departments: args.departments,
        });
      }
    }

    await ctx.db.insert("securityLogs", {
      action: "DEPARTMENT_CHANGED",
      userEmail: actor || "admin",
      targetEmail: lowerEmail,
      details: `Departments updated to: ${args.departments.join(", ") || "(none)"}`,
      timestamp: Date.now(),
    });
  },
});

export const deleteStaff = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const lowerEmail = args.email.toLowerCase();
    console.log(`Attempting to revoke/delete staff: ${lowerEmail}`);
    
    const existing = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", lowerEmail))
      .first();
    
    if (existing) {
      console.log(`Patching existing record ${existing._id} to Revoked`);
      await ctx.db.patch(existing._id, { role: "Revoked" });
    } else {
      const initial = INITIAL_STAFF.find(
        (s) => s.email.toLowerCase() === lowerEmail
      );
      if (initial) {
        console.log(`Inserting INITIAL_STAFF record as Revoked for ${lowerEmail}`);
        await ctx.db.insert("staff", {
          name: initial.name,
          email: initial.email.toLowerCase(),
          role: "Revoked",
        });
      } else {
        console.log(`No record found for ${lowerEmail} to revoke.`);
      }
    }
  },
});

export const updateProfile = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    bio: v.optional(v.union(v.string(), v.null())),
    avatarUrl: v.optional(v.union(v.string(), v.null())),
    country: v.optional(v.union(v.string(), v.null())),
    status: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const lowerEmail = args.email.toLowerCase();
    const existing = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", lowerEmail))
      .first();

    const updates: any = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.bio !== undefined) updates.bio = args.bio;
    if (args.avatarUrl !== undefined) updates.avatarUrl = args.avatarUrl;
    if (args.country !== undefined) updates.country = args.country;
    if (args.status !== undefined) updates.status = args.status;

    if (existing) {
      await ctx.db.patch(existing._id, updates);
    } else {
      const initial = INITIAL_STAFF.find(s => s.email.toLowerCase() === lowerEmail);
      await ctx.db.insert("staff", {
        name: args.name || initial?.name || "User",
        email: lowerEmail,
        role: initial?.role || "Programmer",
        ...updates,
      });
    }
  },
});

export const resetPassword = mutation({
  args: {
    targetEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const lowerEmail = args.targetEmail.toLowerCase();
    const existing = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", lowerEmail))
      .first();

    if (existing) {
      // Clear the password so the user must set a new one on next login
      await ctx.db.patch(existing._id, { password: undefined });

      // Audit log
      await ctx.db.insert("securityLogs", {
        action: "PASSWORD_RESET_BY_ADMIN",
        userEmail: "admin",
        targetEmail: lowerEmail,
        details: "Admin reset password for user.",
        timestamp: Date.now(),
      });
    }
  },
});

export const getSecurityQuestion = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const lowerEmail = args.email.toLowerCase();
    const existing = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", lowerEmail))
      .first();

    if (!existing || existing.role === "Revoked") {
      throw new Error("Account not found or revoked.");
    }

    if (!existing.securityQuestion) {
      throw new Error("No security question is set for this account. Please ask assistance to an admin to reset password.");
    }

    return { question: existing.securityQuestion };
  },
});

export const setSecurityQuestion = mutation({
  args: {
    email: v.string(),
    question: v.string(),
    answer: v.string(),
  },
  handler: async (ctx, args) => {
    const lowerEmail = args.email.toLowerCase();
    const existing = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", lowerEmail))
      .first();

    if (!existing) throw new Error("Account not found.");

    await ctx.db.patch(existing._id, {
      securityQuestion: args.question,
      securityAnswer: args.answer.trim().toLowerCase(),
    });

    // Audit log
    await ctx.db.insert("securityLogs", {
      action: "SECURITY_QUESTION_SET",
      userEmail: lowerEmail,
      targetEmail: lowerEmail,
      details: `Security question updated to: "${args.question}"`,
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

export const verifySecurityAnswer = mutation({
  args: {
    email: v.string(),
    answer: v.string(),
  },
  handler: async (ctx, args) => {
    const lowerEmail = args.email.toLowerCase();
    const existing = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", lowerEmail))
      .first();

    if (!existing) throw new Error("Account not found.");

    if (!existing.securityAnswer) {
      throw new Error("No security question is set for this account.");
    }

    if (existing.securityAnswer !== args.answer.trim().toLowerCase()) {
      // Audit log — failed attempt
      await ctx.db.insert("securityLogs", {
        action: "SECURITY_ANSWER_FAILED",
        userEmail: lowerEmail,
        targetEmail: lowerEmail,
        details: "Incorrect answer to security question.",
        timestamp: Date.now(),
      });
      throw new Error("Incorrect answer to the security question.");
    }

    // Answer is correct, clear the password
    await ctx.db.patch(existing._id, {
      password: undefined,
    });

    // Audit log — success
    await ctx.db.insert("securityLogs", {
      action: "PASSWORD_RESET_VIA_SECURITY_QUESTION",
      userEmail: lowerEmail,
      targetEmail: lowerEmail,
      details: "Password cleared after answering security question correctly.",
      timestamp: Date.now(),
    });

    return { success: true };
  },
});


export const migrateAllPasswordsToHashes = mutation({
  args: {},
  handler: async (ctx) => {
    const staff = await ctx.db.query("staff").collect();
    let count = 0;
    for (const user of staff) {
      if (user.password && !(user.password.length === 64 && /^[0-9a-f]+$/.test(user.password))) {
        const hashed = await hashPassword(user.password);
        await ctx.db.patch(user._id, { password: hashed });
        count++;
      }
    }
    return { migrated: count };
  },
});

/**
 * Check if an email exists in the system and whether it has a password/security question set.
 * Used for the email-first login flow.
 */
export const checkEmailStatus = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const lowerEmail = args.email.toLowerCase();
    const isMainAdmin = lowerEmail === "wmt@ececontactcenters.com";

    if (isMainAdmin) {
      return { exists: true, hasPassword: true, hasSecurityQuestion: true };
    }

    // Check DB first
    const dbUser = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", lowerEmail))
      .first();

    // Fall back to INITIAL_STAFF
    const initial = INITIAL_STAFF.find(
      (s) => s.email.toLowerCase() === lowerEmail
    );
    const user = dbUser || (initial ? { ...initial, password: undefined, securityQuestion: undefined } : null);

    if (!user) {
      // Not found — could be a new registration attempt
      return { exists: false, hasPassword: false, hasSecurityQuestion: false };
    }

    if ((user as any).role === "Revoked") {
      return { exists: true, revoked: true, hasPassword: false, hasSecurityQuestion: false };
    }

    return {
      exists: true,
      hasPassword: !!(user as any).password,
      hasSecurityQuestion: !!(user as any).securityQuestion,
    };
  },
});

