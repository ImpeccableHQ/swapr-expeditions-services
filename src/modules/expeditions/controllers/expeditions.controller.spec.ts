import { Server } from '@hapi/hapi';
import dayjs from 'dayjs';
import { Wallet } from 'ethers';
import mongoose from 'mongoose';
// Modules
import { create, configure } from '../../../server';
import { VisitModel } from '../models';

describe('Expeditions Controllers', () => {
  let server: Server;
  // Random test wallet
  const testWallet = Wallet.createRandom();

  beforeEach(async () => {
    await mongoose.connect(process.env.MONGO_URI as string);
    server = await configure(create());
    await server.initialize();
  });

  afterEach(async () => {
    await server.stop();
    await mongoose.disconnect();
  });

  describe('getDailyVisitsController', () => {
    test('should return default values when address has no previous data', async () => {
      const signupRes = await server.inject({
        method: 'GET',
        url: `/expeditions?address=${testWallet.address}`,
      });

      expect(signupRes.statusCode).toBe(200);
      expect((signupRes.result as any).data).toEqual({
        address: testWallet.address,
        allVisits: 0,
        lastVisit: 0,
      });
    });

    test('should return correct data values when address has no previous data', async () => {
      const testDate = dayjs().utc().add(-2, 'days').toDate();

      // Inject data into mongoose
      await new VisitModel({
        address: testWallet.address,
        allVisits: 4,
        lastVisit: testDate,
      }).save();

      const signature = await testWallet.signMessage('Swapr Dail Visit');

      const signupRes = await server.inject({
        method: 'POST',
        url: `/expeditions/daily-visit`,
        payload: {
          signature,
        },
      });

      expect(signupRes.statusCode).toBe(200);
      expect((signupRes.result as any).data.allVisits).toEqual(5);
    });
  });
});

