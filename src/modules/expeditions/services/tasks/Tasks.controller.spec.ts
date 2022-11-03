import { Server } from '@hapi/hapi';

import { constants, Wallet } from 'ethers';

import { HydratedDocument } from 'mongoose';

import { ClaimRequest, ClaimResult, TasksTypes } from './Tasks.types';
import { dayjs } from '../../../shared/dayjs';

import { ICampaign } from '../../interfaces/ICampaign.interface';

import { CampaignModel } from '../../models/Campaign.model';

import { VisitModel } from '../../models/Visit.model';

import { getWeekInformation, WeekInformation } from '../../utils';

import {
  createMakeRequest,
  startMockServer,
  stopMockServer,
  TypedRequestCreator,
} from '../../utils/tests/setup';

import { multichainSubgraphService } from '../multichainSubgraph/MultichainSubgraph.service';

import { WeeklyFragmentModel } from '../../models/WeeklyFragment.model';

const generateProvisionData = (positions: number[]) =>
  positions.map(position => ({ amountUSD: position.toString() }));

const generateStakingData = (positions: number[]) =>
  positions.map(position => ({
    __typename: 'Deposit',

    amount: position.toString(),

    liquidityMiningCampaign: {
      stakablePair: {
        totalSupply: '1',

        reserveUSD: 1,
      },
    },
  }));

describe('Tasks controller', () => {
  const testWallet = Wallet.createRandom();

  let server: Server;

  let campaign: HydratedDocument<ICampaign>;

  let week: WeekInformation;

  beforeEach(async () => {
    server = await startMockServer();

    week = getWeekInformation();

    campaign = await new CampaignModel({
      startDate: week.startDate.subtract(2, 'weeks').toDate(),

      endDate: week.endDate.add(2, 'weeks').toDate(),

      redeemEndDate: week.endDate.add(3, 'weeks').toDate(),

      initiatorAddress: constants.AddressZero,
    }).save();
  });

  afterEach(async () => {
    await stopMockServer(server);
  });

  describe('claim', () => {
    let makeClaimRequest: TypedRequestCreator<ClaimRequest['payload']>;

    beforeEach(() => {
      makeClaimRequest = createMakeRequest<ClaimRequest['payload']>(server, {
        method: 'POST',
        url: '/expeditions/claim',
      });
    });

    it('throws when no active campaign has been found', async () => {
      await CampaignModel.findByIdAndDelete(campaign._id);

      const signature = await testWallet.signMessage(TasksTypes.VISIT);

      const testRes = await makeClaimRequest({
        signature,

        address: testWallet.address,

        type: TasksTypes.VISIT,
      });

      expect(testRes.result).toEqual({
        statusCode: 400,

        error: 'Bad Request',

        message: 'No active campaign has been found',
      });
    });

    describe('daily visit', () => {
      let signature: string;

      beforeAll(async () => {
        signature = await testWallet.signMessage(TasksTypes.VISIT);
      });

      test('should return updated allVisits count after claimng fragment', async () => {
        const testRes = await makeClaimRequest({
          signature,

          address: testWallet.address,

          type: TasksTypes.VISIT,
        });

        expect(testRes.statusCode).toBe(200);

        expect(testRes.result).toEqual<ClaimResult>({
          claimedFragments: 0,

          type: TasksTypes.VISIT,
        });
      });

      test('should increase visits by one when address has previous visits', async () => {
        const testDate = dayjs().utc().add(-2, 'days').toDate();

        const visitDocument = await new VisitModel({
          address: testWallet.address,

          allVisits: 4,

          lastVisit: testDate,

          campaign_id: campaign._id,
        }).save();

        const testRes = await makeClaimRequest({
          signature,

          address: testWallet.address,

          type: TasksTypes.VISIT,
        });

        expect(testRes.statusCode).toBe(200);

        const newVisitDocument = await VisitModel.findById(visitDocument._id);

        if (!newVisitDocument) {
          throw new Error('Document not found');
        }

        expect(newVisitDocument.allVisits).toEqual(5);
      });
    });

    describe('liquidity provision', () => {
      let provisionMock: jest.SpyInstance;

      let provisionSignature: string;

      beforeAll(async () => {
        provisionMock = jest.spyOn(
          multichainSubgraphService,
          'getLiquidityPositionDepositsBetweenTimestampAAndTimestampB'
        );
        provisionSignature = await testWallet.signMessage(
          TasksTypes.LIQUIDITY_PROVISION
        );
      });

      afterAll(() => {
        jest.restoreAllMocks();
      });

      it('throws if 50 USD equivalent has not been reached', async () => {
        provisionMock.mockResolvedValue(generateProvisionData([10, 20]));

        const testRes = await makeClaimRequest({
          signature: provisionSignature,

          address: testWallet.address,

          type: TasksTypes.LIQUIDITY_PROVISION,
        });

        expect(testRes.result).toEqual({
          statusCode: 400,

          error: 'Bad Request',

          message: 'No claimable fragments',
        });
      });

      it('throws if already claimed', async () => {
        provisionMock.mockResolvedValue(generateProvisionData([50]));

        await new WeeklyFragmentModel({
          address: testWallet.address,

          type: TasksTypes.LIQUIDITY_PROVISION,

          fragments: 50,

          campaign_id: campaign._id,

          week: week.weekNumber,

          year: week.year,
        }).save();

        const testRes = await makeClaimRequest({
          signature: provisionSignature,

          address: testWallet.address,

          type: TasksTypes.LIQUIDITY_PROVISION,
        });

        expect(testRes.result).toEqual({
          statusCode: 400,

          error: 'Bad Request',

          message: `Weekly fragment for LIQUIDITY_PROVISION for ${week.weekDate} already claimed`,
        });
      });

      it('applies streak bonus', async () => {
        provisionMock.mockResolvedValue(generateProvisionData([50]));

        await new WeeklyFragmentModel({
          address: testWallet.address,

          type: TasksTypes.LIQUIDITY_PROVISION,

          fragments: 50,

          campaign_id: campaign._id,

          week: week.weekNumber - 2,

          year: week.year,
        }).save();

        await new WeeklyFragmentModel({
          address: testWallet.address,

          type: TasksTypes.LIQUIDITY_PROVISION,

          fragments: 100,

          campaign_id: campaign._id,

          week: week.weekNumber - 1,

          year: week.year,
        }).save();

        const testRes = await makeClaimRequest({
          signature: provisionSignature,

          address: testWallet.address,

          type: TasksTypes.LIQUIDITY_PROVISION,
        });

        expect(testRes.result).toEqual<ClaimResult>({
          claimedFragments: 150,

          type: TasksTypes.LIQUIDITY_PROVISION,
        });
      });
    });

    describe('liquidity staking', () => {
      let stakingMock: jest.SpyInstance;

      let stakingSignature: string;

      beforeAll(async () => {
        stakingMock = jest.spyOn(
          multichainSubgraphService,
          'getLiquidityStakingPositionBetweenTimestampAAndTimestampB'
        );
        stakingSignature = await testWallet.signMessage(
          TasksTypes.LIQUIDITY_STAKING
        );
      });

      afterAll(() => {
        jest.restoreAllMocks();
      });

      it('throws if 50 USD equivalent has not been reached', async () => {
        stakingMock.mockResolvedValue(generateStakingData([10, 20]));

        const testRes = await makeClaimRequest({
          signature: stakingSignature,

          address: testWallet.address,

          type: TasksTypes.LIQUIDITY_STAKING,
        });

        expect(testRes.result).toEqual({
          statusCode: 400,

          error: 'Bad Request',

          message: 'No claimable fragments',
        });
      });

      it('throws if already claimed', async () => {
        stakingMock.mockResolvedValue(generateStakingData([50]));

        await new WeeklyFragmentModel({
          address: testWallet.address,

          type: TasksTypes.LIQUIDITY_STAKING,

          fragments: 50,

          campaign_id: campaign._id,

          week: week.weekNumber,

          year: week.year,
        }).save();

        const testRes = await makeClaimRequest({
          signature: stakingSignature,

          address: testWallet.address,

          type: TasksTypes.LIQUIDITY_STAKING,
        });

        expect(testRes.result).toEqual({
          statusCode: 400,

          error: 'Bad Request',

          message: `Weekly fragment for LIQUIDITY_STAKING for ${week.weekDate} already claimed`,
        });
      });

      it('applies streak bonus', async () => {
        stakingMock.mockResolvedValue(generateStakingData([50]));

        await new WeeklyFragmentModel({
          address: testWallet.address,

          type: TasksTypes.LIQUIDITY_STAKING,

          fragments: 50,

          campaign_id: campaign._id,

          week: week.weekNumber - 2,

          year: week.year,
        }).save();

        await new WeeklyFragmentModel({
          address: testWallet.address,

          type: TasksTypes.LIQUIDITY_STAKING,

          fragments: 100,

          campaign_id: campaign._id,

          week: week.weekNumber - 1,

          year: week.year,
        }).save();

        const testRes = await makeClaimRequest({
          signature: stakingSignature,

          address: testWallet.address,

          type: TasksTypes.LIQUIDITY_STAKING,
        });

        expect(testRes.result).toEqual<ClaimResult>({
          claimedFragments: 150,

          type: TasksTypes.LIQUIDITY_STAKING,
        });
      });
    });
  });
});
