const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = function(passport) {
  
  passport.use(new LocalStrategy(
    { 
      usernameField: 'email',
      passwordField: 'password'
    },
    async (email, password, done) => {
      try {
        console.log('Attempting to authenticate user:', { email });
        
        const user = await prisma.user.findUnique({
          where: { email: email },
          include: {
            profile: true,
            userRoles: {
              include: {
                role: true
              }
            }
          }
        });

        if (!user) {
          console.log('User not found:', { email });
          return done(null, false, { message: 'ユーザーが見つかりません' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        console.log('Password verification result:', { isMatch });
        
        if (!isMatch) {
          return done(null, false, { message: 'パスワードが間違っています' });
        }

        console.log('Authentication successful:', { userId: user.id, roles: user.userRoles.map(ur => ur.role.name) });
        return done(null, user);
      } catch (err) {
        console.error('Authentication error:', err);
        return done(err);
      }
    }
  ));

  passport.serializeUser((user, done) => {
    console.log('Serializing user:', { userId: user.id, roles: user.userRoles.map(ur => ur.role.name) });
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      console.log('Deserializing user:', { userId: id });
      const user = await prisma.user.findUnique({
        where: { id: id },
        include: {
          profile: true,
          userRoles: {
            include: {
              role: true
            }
          }
        }
      });
      if (!user) {
        console.log('User not found during deserialization:', { userId: id });
        return done(null, false);
      }
      console.log('Deserialization successful:', { userId: user.id, roles: user.userRoles.map(ur => ur.role.name) });
      done(null, user);
    } catch (err) {
      console.error('Deserialization error:', err);
      done(err);
    }
  });
}; 