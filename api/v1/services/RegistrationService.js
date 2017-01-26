var CheckitError = require('checkit').Error;
var _Promise = require('bluebird');
var _ = require('lodash');

var Model = require('../models/Model');
var Mentor = require('../models/Mentor');
var User = require('../models/User');
var MailingList = require('../models/MailingList');
var Attendee = require('../models/Attendee');
var User = require('../models/User');
var UserRole = require('../models/UserRole');
var MailService = require('../services/MailService');
var errors = require('../errors');
var utils = require('../utils');
var MailService = require('../services/MailService');

/**
 * Persists (insert or update) a model instance and creates (insert only) any
 * related models as provided by the related mapping. Use #extractRelatedObjects
 * in combination with #adjustRelatedObjects to update related models.
 * @param  {Model} model	a model object to be created/updated
 * @param  {Object} related an object mapping related models to array of related
 *                          model attribute objects
 * @param  {Transaction} t	a pending transaction
 * @return {Promise<Model>} the model with its related models
 */
function _saveWithRelated(model, related, t) {
	return model.save(null, { require: false, transacting: t }).then(function (model) {
		var relatedPromises = [];

		_.forIn(related, function (instances, relatedName) {
			_.forEach(instances, function (attributes) {
				relatedPromises.push(
					model.related(relatedName).create(attributes, { transacting: t })
				);
			});
		});

		return _Promise.all(relatedPromises).return(model);
	});
}

/**
 * Determines which related objects are new (need to be inserted) and which
 * are existing ones (need to be updated)
 * @param  {Model} model	the model with which the related objects are associated
 * @param  {String} fkName	the name of the column on which all related models
 *                         	have their foreign key
 * @param  {Object} related	an object mapping related models to array of related
 *                          model attribute objects
 * @return {Object}			mapping of new objects, updated objects, and ids of
 *                          updated objects
 */
function _extractRelatedObjects(model, fkName, related) {
	var result = { };

	_.forIn(related, function (instances, relatedName) {
		result[relatedName] = { new: [], updated: [], updatedIds: [] };

		_.forEach(instances, function (attributes) {
			var MESSAGE, SOURCE;
			if (!_.has(attributes, 'id')) {
				result[relatedName].new.push(attributes);
			} else if (_.isUndefined(model.related(relatedName).get(attributes.id))) {
				MESSAGE = "A related " + relatedName + " object with the given ID does not exist";
				SOURCE = relatedName + ".id";
				throw new errors.NotFoundError(MESSAGE, SOURCE);
			} else if (model.related(relatedName).get(attributes.id).get(fkName) !== model.get('id')){
				MESSAGE = "A " + relatedName + " object that does not belong to this resource cannot be updated here";
				throw new errors.UnauthorizedError(MESSAGE);
			} else {
				// TODO remove this once Request validator can marshal recursively
				// (prevents unauthorized reassignment of related object to another model)
				attributes[fkName] = model.get('id');

				result[relatedName].updated.push(model.related(relatedName).get(attributes.id).set(attributes));
				result[relatedName].updatedIds.push(attributes.id);
			}
		});
	});

	return _Promise.resolve(result);
}

/**
 * Removes unwanted objects and updates desired objects
 * @param  {Model} model			the model with which the ideas are associated
 * @param  {Object} adjustments		the resolved result of #_extractRelatedObjects
 * @param  {Transaction} t			a pending transaction
 * @return {Promise<>}				a promise indicating all changes have been added to the transaction
 */
function _adjustRelatedObjects(model, adjustments, t) {
	var relatedPromises = [];

	_.forIn(adjustments, function (adjustment, relatedName) {
		var promise = model.related(relatedName)
			.query().transacting(t)
			.whereNotIn('id', adjustment.updatedIds)
			.delete()
			.catch(Model.NoRowsDeletedError, function () { return null; })
			.then(function () {
				model.related(relatedName).reset();

				return _Promise.map(adjustment.updated, function (updated) {
					model.related(relatedName).add(updated);
					return updated.save(null, { transacting: t, require: false });
				});
			});

		relatedPromises.push(promise);
	});

	return _Promise.all(relatedPromises);
}

/**
 * Adds people to the correct mailing lists based on decisions
 * @param  {Object} oldAttributes	the old set of attributes for a user
 * @param  {Object} newAttributes	the new set of decision attributes for a user
 * @return {Promise<MailingListUser>}	a promise with the save result 
 */
function _addToMailingList(oldAttributes, newAttributes){
	//Status not finalized or nothing has changed, don't add to any list
	if(_.isUndefined(newAttributes.status) || newAttributes.status === "PENDING"){
		return;
	}

	var oldWave = oldAttributes.wave;
	var newWave = newAttributes.wave;
	var oldStatus = oldAttributes.status;
	var newStatus = newAttributes.status;
	var currentUser;

	//If the status of the user has just been finalized - this is the initial decision
	if(oldStatus === "PENDING" && newStatus !== "PENDING"){
		return User.findById(oldAttributes.userId)
			.then(function (user){
				currentUser = user.attributes;
				if(newAttributes.status == "ACCEPTED"){
					listName = "wave" + newAttributes.wave;
				}else if(newAttributes.status == "REJECTED"){
					listName = "rejected";
				}else{
					listName = "waitlisted";
				}
				var newList = utils.mail.lists[listName];
				return MailService.addToList(currentUser, newList);
			});
	}
	//Applicant's wave was changed
	else if(oldWave != newWave && oldStatus === newStatus && newStatus === "ACCEPTED"){
		var oldListName = "wave" + oldWave;
		var newListName = "wave" + newWave;

		return User.findById(oldAttributes.userId)
			.then(function (user) {
				currentUser = user;
				var oldList = utils.mail.lists[oldListName];
				var newList = utils.mail.lists[newListName];

				var promises = [];
				promises.push(MailService.removeFromList(currentUser, oldList));
				promises.push(MailService.addToList(currentUser, newList));
				return _Promise.all(promises);
			})
	}
	//Applicant accepted off of waitlist
	else if(oldStatus === "WAITLISTED" && newStatus === "ACCEPTED"){
		return User.findById(oldAttributes.userId)
			.then(function (user) {
				currentUser = user;
				var waitList = utils.mail.lists.waitlisted;
				var newListName = "wave" + newWave;
				var newList = utils.mail.lists[newListName];

				var promises = [];
				promises.push(MailService.removeFromList(currentUser, waitList));
				promises.push(MailService.addToList(currentUser, newList));
				return _Promise.all(promises);
			});
	}
	//Applicant rejected off of waitlist
	else if(oldStatus === "WAITLISTED" && newStatus === "REJECTED"){
		return User.findById(oldAttributes.userId)
			.then(function (user) {
				currentUser = user;
				var waitList = utils.mail.lists.waitlisted;
				var rejectList = utils.mail.lists.rejected;

				var promises = [];
				promises.push(MailService.removeFromList(currentUser, waitList));
				promises.push(MailService.addToList(currentUser, rejectList));
				return _Promise.all(promises);
			});
	}
}

/**
* Registers a mentor and their project ideas for the given user
* @param  {Object} user the user for which a mentor will be registered
* @param  {Object} attributes a JSON object holding the mentor attributes
* @return {Promise<Mentor>} the mentor with related ideas
* @throws {InvalidParameterError} when a mentor exists for the specified user
*/
module.exports.createMentor = function (user, attributes) {
	var mentorAttributes = attributes.mentor;
	delete attributes.mentor;

	mentorAttributes.userId = user.get('id');
	var mentor = Mentor.forge(mentorAttributes);

	return mentor.validate()
		.catch(CheckitError, utils.errors.handleValidationError)
		.then(function (validated) {
			if (user.hasRole(utils.roles.MENTOR, false)) {
				var message = "The given user has already registered as a mentor";
				var source = "userId";
				throw new errors.InvalidParameterError(message, source);
			}

			return Mentor.transaction(function (t) {
				return UserRole
					.addRole(user, utils.roles.MENTOR, false, t)
					.then(function (result) {
						return _saveWithRelated(mentor, attributes);
					});
				});
			});
};

/**
* Finds a mentor by querying on a user's ID
* @param  {User} user		the user expected to be associated with a mentor
* @return {Promise<Mentor>}	resolving to the associated Mentor model
* @throws {NotFoundError} when the requested mentor cannot be found
*/
module.exports.findMentorByUser = function (user) {
	return Mentor.findByUserId(user.get('id')).tap(function (result) {
		if (_.isNull(result)) {
			var message = "A mentor with the given user ID cannot be found";
			var source = "userId";
			throw new errors.NotFoundError(message, source);
		}
	});
};

/**
* Finds a mentor by querying for the given ID
* @param  {Number} id the ID to query
* @return {Promise<Mentor>} resolving to the associated Mentor model
* @throws {NotFoundError} when the requested mentor cannot be found
*/
module.exports.findMentorById = function (id) {
	return Mentor.findById(id).tap(function (result) {
		if (_.isNull(result)) {
			var message = "A mentor with the given ID cannot be found";
			var source = "id";
			throw new errors.NotFoundError(message, source);
		}
	});
};

/**
* Updates a mentor and their project ideas by relational user
* @param  {Mentor} mentor the mentor to be updated
* @param  {Object} attributes a JSON object holding the mentor registration attributes
* @return {Promise} resolving to an object in the same format as attributes, holding the saved models
* @throws {InvalidParameterError} when a mentor doesn't exist for the specified user
*/
module.exports.updateMentor = function (mentor, attributes) {
	var mentorAttributes = attributes.mentor;
	delete attributes.mentor;

	mentor.set(mentorAttributes);

	return mentor.validate()
		.catch(CheckitError, utils.errors.handleValidationError)
		.then(function (){
			return _extractRelatedObjects(mentor, 'mentorId', attributes);
		})
		.then(function (adjustments){
			return Mentor.transaction(function (t) {
				return _adjustMentorIdeas(mentor, adjustments, t).then(function () {
					return _saveWithRelated(mentor, { 'ideas': adjustments.ideas.new }, t);
				});
			});
		});
};

/**
* Registers an attendee for the given user
* @param  {Object} user the user for which an attendee will be registered
* @param  {Object} attributes a JSON object holding the attendee attributes
* @return {Promise<Attendee>} the attendee with their related properties
* @throws {InvalidParameterError} when an attendee exists for the specified user
*/
module.exports.createAttendee = function (user, attributes) {
	var attendeeAttrs = attributes.attendee;
	delete attributes.attendee;

	attendeeAttrs.userId = user.get('id');
	var attendee = Attendee.forge(attendeeAttrs);

	return attendee.validate()
		.catch(CheckitError, utils.errors.handleValidationError)
		.then(function (validated) {
			if (user.hasRole(utils.roles.ATTENDEE, false)) {
				var message = "The given user has already registered as an attendee";
				var source = "userId";
				throw new errors.InvalidParameterError(message, source);
			}

			return Attendee.transaction(function (t) {
				return UserRole
					.addRole(user, utils.roles.ATTENDEE, false, t)
					.then(function (result) {
						return _saveWithRelated(attendee, attributes, t);
					});
				});
			});
};

/**
* Finds an attendee by querying on a user's ID
* @param  {User} user		the user expected to be associated with an attendee
* @param  {Boolean} withResume	whether or not to fetch the attendee with its resume
* @return {Promise<Attendee>}	resolving to the associated Attendee model
* @throws {NotFoundError} when the requested attendee cannot be found
*/
module.exports.findAttendeeByUser = function (user, withResume) {
	var findFunction;
	if(withResume)
		findFunction = Attendee.fetchWithResumeByUserId;
	else
		findFunction = Attendee.findByUserId;

	return findFunction(user.get('id')).tap(function (result) {
		if (_.isNull(result)) {
			var message = "A attendee with the given user ID cannot be found";
			var source = "userId";
			throw new errors.NotFoundError(message, source);
		}
	});
};

/**
* Finds an attendee by querying for the given ID
* @param  {Number} id the ID to query
* @param  {Boolean} withResume	whether or not to fetch the attendee with its resume
* @return {Promise<Attendee>} resolving to the associated Attendee model
* @throws {NotFoundError} when the requested attendee cannot be found
*/
module.exports.findAttendeeById = function (id, withResume) {
	var findFunction;
	if(withResume)
		findFunction = Attendee.fetchWithResumeById;
	else
		findFunction = Attendee.findById;

	return findFunction(id).tap(function (result) {
		if (_.isNull(result)) {
			var message = "A attendee with the given ID cannot be found";
			var source = "id";
			throw new errors.NotFoundError(message, source);
		}
	});
};


/**
* Updates an attendee and their relational tables by relational user
* @param  {Attendee} attendee the attendee to be updated
* @param  {Object} attributes a JSON object holding the attendee registration attributes
* @return {Promise} resolving to an object in the same format as attributes, holding the saved models
* @throws {InvalidParameterError} when an attendee doesn't exist for the specified user
*/
module.exports.updateAttendee = function (attendee, attributes) {
	// some attendee registration attributes are optional, but we need to
	// be sure that they are at least considered for removal during adjustment
	attributes = _.merge(attributes, { 'projects': [], 'extras': [], 'collaborators': [] });

	var attendeeAttrs = attributes.attendee;
	delete attributes.attendee;

	var user = User.forge({ id: attendee.get('userId') });
	if (!_.isUndefined(attendeeAttrs.status) && (attendee.get('status') !== attendeeAttrs.status)) {
		// reviewer has changed status; might need to add/remove from lightning list
		// TODO move this block out of here when separate review feature is available
		if (attendeeAttrs.status !== 'ACCEPTED') {
			MailService.removeFromList(user, utils.mail.lists.lightningTalks);
		} else if (attendeeAttrs.hasLightningInterest) {
			MailService.addToList(user, utils.mail.lists.lightningTalks);
		}
	} else if ((!!attendee.get('hasLightningInterest')) !== attendeeAttrs.hasLightningInterest) {
		// preferences were changed but status stays the same
		if (attendee.get('status') !== 'ACCEPTED') {
			// we do not add attendees to this list until they have been accepted
		}
		else if (attendeeAttrs.hasLightningInterest) {
			MailService.addToList(user, utils.mail.lists.lightningTalks);
		} else {
			MailService.removeFromList(user, utils.mail.lists.lightningTalks);
		}
	}

	attendee.set(attendeeAttrs);

	return attendee.validate()
		.catch(CheckitError, utils.errors.handleValidationError)
		.then(function (){
			return _extractRelatedObjects(attendee, 'attendeeId', attributes);
		})
		.then(function (adjustments) {
			return Attendee.transaction(function (t) {
				return _adjustRelatedObjects(attendee, adjustments, t)
					.then(function () {
						var newRelated = _.mapValues(adjustments, function (adjustment, adjustments) {
							return adjustment.new;
						});
						return _saveWithRelated(attendee, newRelated, t);
					});
				});
			});
};


module.exports.applyDecision = function (attendee, decisionAttrs) {
	_addToMailingList(attendee.attributes, decisionAttrs);
	attendee.set(decisionAttrs);

	return attendee.validate()
		.catch(CheckitError, utils.errors.handleValidationError)
		.then(function () {
			return attendee.save();
		})
		.then(function (model) {
			return model;
		})
}

/**
* Fetches all attendees by a specified order and category
* @param  {int} page the page of the paginated response JSON
* @param  {int} number of results of per page
* @param {string} category to sort by
* @param {int} ascending 0 or 1 signaling what way to order the results
* @return {Promise} resolving to a the list of attendees
*/
module.exports.fetchAllAttendees = function(page, count, category, ascending) {
	var ordering = (ascending ? '' : '-') + category;
	return Attendee.forge()
		.orderBy(ordering)
		.fetchPage({
			pageSize: count,
			page: page
		})
		.then(function (results) {
			var attendees = _.map(results.models, 'attributes');
			return attendees;
		});
}

/**
* Fetches attendees by either first or last name
* @param  {int} page the page of the paginated response JSON
* @param  {int} number of results of per page
* @param  {string} category to sort by
* @param  {int} ascending 0 or 1 signaling what way to order the results
* @param  {string} searchTerm the name of the person to find
* @return {Promise} resolving to a the list of attendees
*/
module.exports.findAttendeesByName = function(page, count, category, ascending, searchTerm) {
	var ordering = (ascending ? '' : '-') + category;
	return Attendee
		.query(function (qb) {
			qb.where('first_name', 'LIKE', searchTerm).orWhere('last_name', 'LIKE', searchTerm);
		})
		.orderBy(ordering)
		.fetchPage({
			pageSize: count,
			page: page
		})
		.then(function (results) {
			var attendees = _.map(results.models, 'attributes');
			return attendees;
		});
}

/**
* Fetches attendees by either first or last name
* @param  {int} page the page of the paginated response JSON
* @param  {int} number of results of per page
* @param  {string} category to sort by
* @param  {int} ascending 0 or 1 signaling what way to order the results
* @param  {string} filterCategory the category to filter by
* @param  {string} filterVal the value of the filter to go by
* @return {Promise} resolving to a the list of attendees
*/
module.exports.filterAttendees = function(page, count, category, ascending, filterCategory, filterVal) {
	var ordering = (ascending ? '' : '-') + category;
	return Attendee
		.query(function (qb) {
			qb.where(filterCategory, '=', filterVal);
		})
		.orderBy(ordering)
		.fetchPage({
			pageSize: count,
			page: page
		})
		.then(function (results) {
			var attendees = _.map(results.models, 'attributes');
			return attendees;
		});
}
