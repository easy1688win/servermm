
import { User } from '../models';
import sequelize from '../config/database';

async function checkUsers() {
  try {
    await sequelize.authenticate();
    const users = await User.findAll();
    console.log('Users found:', users.map(u => u.username));
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkUsers();
