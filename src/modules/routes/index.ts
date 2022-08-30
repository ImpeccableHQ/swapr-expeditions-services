import { HandlerDecorations, Server } from '@hapi/hapi';
import Joi from 'joi';

import {
  claimDailyVisitFragments as claimDailyVisitFragmentsController,
  getDailyVisitFragments as getDailyVisitFragmentsController,
  getWeeklyFragments as getWeeklyFragmentsController,
  claimWeeklyLiquidityProvisionFragments as claimWeeklyLiquidityProvisionFragmentsController,
} from '../expeditions';

import {
  AddressWithSignatureDTO,
  ClaimWeeklyFragmentsForLiquidityPositionDepositsResponseDTO,
  DailyVisitsResponseDTO,
  GetWeeklyRewardsFragmentsResponseDTO,
} from '../expeditions/controllers/expeditions.dto';

import { address } from './validations';
async function register(server: Server) {
  // Return nothing
  server.route({
    method: '*',
    path: '/',
    handler: async (_, h) => h.response().code(204),
  });

  server.route({
    method: 'GET',
    path: '/expeditions/daily-visits',
    options: {
      description: `Get daily rewards (fragments) state for an address`,
      validate: {
        query: {
          address,
        },
      },
      tags: ['api', 'expeditions', 'daily visit', 'fragments'],
      response: {
        schema: DailyVisitsResponseDTO,
      },
    },
    handler: getDailyVisitFragmentsController as HandlerDecorations,
  });

  server.route({
    method: 'POST',
    path: '/expeditions/daily-visits',
    options: {
      description: `Claim all daily fragments available for an address`,
      validate: {
        payload: AddressWithSignatureDTO,
      },
      tags: ['api', 'expeditions', 'daily visits'],
      response: {
        schema: DailyVisitsResponseDTO,
      },
    },
    handler: claimDailyVisitFragmentsController as HandlerDecorations,
  });

  server.route({
    method: 'GET',
    path: '/expeditions/weekly-fragments',
    options: {
      description: `Get weekly rewards (fragments) state for an address`,
      validate: {
        query: {
          address,
          week: Joi.string().optional(),
        },
      },
      tags: [
        'api',
        'expeditions',
        'weekly liquidity',
        'weekly rewards',
        'weekly rewards fragments',
      ],
      response: {
        schema: GetWeeklyRewardsFragmentsResponseDTO,
      },
    },
    handler: getWeeklyFragmentsController as HandlerDecorations,
  });

  server.route({
    method: 'POST',
    path: '/expeditions/weekly-fragments/liquiditt-provision/claim',
    options: {
      description: `Claim all weekly fragments available for an address`,
      validate: {
        payload: AddressWithSignatureDTO,
      },
      tags: ['api', 'expeditions', 'weekly liquidity'],
      response: {
        schema: ClaimWeeklyFragmentsForLiquidityPositionDepositsResponseDTO,
      },
    },
    handler: claimWeeklyLiquidityProvisionFragmentsController as HandlerDecorations,
  });
}

export const RoutesPlugin = {
  name: 'swapr-expeditions-api/routes',
  version: '0.0.1',
  register,
};
